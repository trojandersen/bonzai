const { sendResponse, sendError } = require("../../responses");
const { db } = require("../../services/db");

// Utility function to allocate rooms based on type
async function allocateRooms(numOfSingleRooms, numOfDoubleRooms, numOfSuiteRooms, previousRooms = []) {
  const inventoryCheckParams = {
    TableName: "bonzaiInventory",
    FilterExpression: "roomIsAvailable = :true OR roomId IN (:previousRooms)",
    ExpressionAttributeValues: {
      ":true": true,
      ":previousRooms": previousRooms.length > 0 ? previousRooms : ["-"],
    },
  };
  const inventory = await db.scan(inventoryCheckParams);
  const availableRooms = inventory.Items;

  // Allocate rooms based on type and availability
  const allocatedRooms = [
    ...availableRooms.filter((room) => room.roomType === "Single").slice(0, numOfSingleRooms).map((room) => room.roomId),
    ...availableRooms.filter((room) => room.roomType === "Double").slice(0, numOfDoubleRooms).map((room) => room.roomId),
    ...availableRooms.filter((room) => room.roomType === "Suite").slice(0, numOfSuiteRooms).map((room) => room.roomId),
  ];

  return allocatedRooms;
}

// Utility function to update room inventory (free and allocate rooms)
async function updateRoomInventory(freeRooms, allocateRooms) {
  // Set previously used rooms to available
  const freeUpPreviousRooms = freeRooms.map((roomId) => ({
    TableName: "bonzaiInventory",
    Key: { roomId },
    UpdateExpression: "set roomIsAvailable = :true",
    ExpressionAttributeValues: { ":true": true },
  }));

  // Mark newly allocated rooms as unavailable
  const markRoomsAsUnavailable = allocateRooms.map((roomId) => ({
    TableName: "bonzaiInventory",
    Key: { roomId },
    UpdateExpression: "set roomIsAvailable = :false",
    ExpressionAttributeValues: { ":false": false },
  }));

  // Run both room free-up and marking as unavailable in parallel
  await Promise.all([
    ...freeUpPreviousRooms.map((params) => db.update(params)),
    ...markRoomsAsUnavailable.map((params) => db.update(params)),
  ]);
}

// Utility function to calculate total price based on room types and nights
function calculateTotalPrice(singleRooms, doubleRooms, suiteRooms, checkIn, checkOut) {
  const singleRoomPrice = 500;
  const doubleRoomPrice = 1000;
  const suiteRoomPrice = 1500;
  const nights = (new Date(checkOut) - new Date(checkIn)) / (1000 * 3600 * 24);

  // Calculate total price based on room type and length of stay
  return nights * (
    singleRooms * singleRoomPrice +
    doubleRooms * doubleRoomPrice +
    suiteRooms * suiteRoomPrice
  );
}

// Main handler for updating booking information
exports.handler = async (event) => {
  const { id } = event.pathParameters;
  const {
    guests,
    numOfSingleRooms,
    numOfDoubleRooms,
    numOfSuiteRooms,
    checkIn,
    checkOut,
  } = JSON.parse(event.body);

  // Validate check-in and check-out dates
  const today = new Date().toISOString().split("T")[0];
  if (checkIn < today || new Date(checkOut) <= new Date(checkIn)) {
    return sendError(400, "Invalid check-in/check-out dates.");
  }

  // Calculate total bed capacity based on room types
  const totalBedsAvailable =
    numOfSingleRooms * 1 + numOfDoubleRooms * 2 + numOfSuiteRooms * 2;

  // Calculate total rooms requested and ensure guests >= rooms
  const totalRoomsRequested =
    numOfSingleRooms + numOfDoubleRooms + numOfSuiteRooms;
  if (guests < totalRoomsRequested) {
    return sendError(400, "Number of guests cannot be less than the number of rooms booked.");
  }

  // Ensure the number of guests does not exceed bed capacity
  if (guests > totalBedsAvailable) {
    return sendError(400, "Number of guests exceeds the available number of beds.");
  }

  try {
    // Fetch existing booking by ID
    const checkParams = {
      TableName: "bonzaiBookings",
      Key: { bookingId: id },
    };
    const existingBooking = await db.get(checkParams);
    if (!existingBooking.Item) {
      return sendError(404, "Booking not found.");
    }

    // Get previous room allocations
    const previousRooms = existingBooking.Item.rooms || [];

    // Allocate new rooms based on booking changes
    const allocatedRooms = await allocateRooms(
      numOfSingleRooms,
      numOfDoubleRooms,
      numOfSuiteRooms,
      previousRooms
    );

    // Ensure the number of allocated rooms matches the request
    if (allocatedRooms.length !== totalRoomsRequested) {
      return sendError(400, "Requested room types are not available.");
    }

    // Calculate the total price for the updated booking
    const totalPrice = calculateTotalPrice(
      numOfSingleRooms,
      numOfDoubleRooms,
      numOfSuiteRooms,
      checkIn,
      checkOut
    );

    // Prepare update parameters for the booking
    const params = {
      TableName: "bonzaiBookings",
      Key: { bookingId: id },
      UpdateExpression:
        "set guests = :guests, numOfSingleRooms = :numOfSingleRooms, numOfDoubleRooms = :numOfDoubleRooms, numOfSuiteRooms = :numOfSuiteRooms, checkIn = :checkIn, checkOut = :checkOut, totalPrice = :totalPrice, rooms = :rooms",
      ExpressionAttributeValues: {
        ":guests": guests,
        ":numOfSingleRooms": numOfSingleRooms,
        ":numOfDoubleRooms": numOfDoubleRooms,
        ":numOfSuiteRooms": numOfSuiteRooms,
        ":checkIn": checkIn,
        ":checkOut": checkOut,
        ":totalPrice": totalPrice,
        ":rooms": allocatedRooms,
      },
      ReturnValues: "UPDATED_NEW",
    };

    // Update the booking in the database
    const result = await db.update(params);

    // Update room inventory (free previous rooms and mark new ones unavailable)
    await updateRoomInventory(
      previousRooms.filter(roomId => !allocatedRooms.includes(roomId)),
      allocatedRooms
    );

    // Send success response with updated attributes
    return sendResponse({
      message: "Booking updated successfully.",
      updatedAttributes: result.Attributes,
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    return sendError(500, "Could not update booking.");
  }
};
