const { sendResponse, sendError } = require("../../responses");
const { db } = require("../../services/db");

// Main handler for updating booking information
exports.handler = async (event) => {
  // Extract the booking ID from the path parameters and request body details
  const { id } = event.pathParameters;
  const {
    guests,
    numOfSingleRooms,
    numOfDoubleRooms,
    numOfSuiteRooms,
    checkIn,
    checkOut,
  } = JSON.parse(event.body);

  // Validate the check-in and check-out dates
  const today = new Date().toISOString().split("T")[0];
  if (checkIn < today || new Date(checkOut) <= new Date(checkIn)) {
    return sendError(400, "Invalid check-in/check-out dates.");
  }

  // Calculate total available beds based on the number of rooms of each type
  const totalBedsAvailable =
    numOfSingleRooms * 1 + numOfDoubleRooms * 2 + numOfSuiteRooms * 2;

  // Ensure the number of guests is at least equal to the total number of rooms booked
  const totalRoomsRequested =
    numOfSingleRooms + numOfDoubleRooms + numOfSuiteRooms;
  if (guests < totalRoomsRequested) {
    return sendError(400, "Number of guests cannot be less than the number of rooms booked.");
  }

  // Ensure the number of guests does not exceed the total number of available beds
  if (guests > totalBedsAvailable) {
    return sendError(400, "Number of guests exceeds the available number of beds.");
  }

  try {
    // Fetch the existing booking by its ID
    const checkParams = {
      TableName: "bonzaiBookings",
      ConsistentRead: true,
      Key: { bookingId: id },
    };
    const existingBooking = await db.get(checkParams);
    if (!existingBooking.Item) {
      return sendError(404, "Booking not found.");
    }

    // Get the previously allocated rooms (if any)
    const previousRooms = existingBooking.Item.rooms || [];

    // Check the inventory for available rooms and include previously booked rooms to allow for potential reallocations
    const inventoryCheckParams = {
      TableName: "bonzaiInventory",
      FilterExpression: "roomIsAvailable = :true OR roomId IN (:previousRooms)",
      ExpressionAttributeValues: {
        ":true": true,
        ":previousRooms": previousRooms,
      },
    };
    const inventory = await db.scan(inventoryCheckParams);
    const availableRooms = inventory.Items;

    // Define room prices for each type
    const singleRoomPrice = 500, doubleRoomPrice = 1000, suiteRoomPrice = 1500;

    // Allocate rooms by filtering the available rooms based on the requested room types
    const allocatedRooms = [
      ...availableRooms.filter((room) => room.roomType === "Single").slice(0, numOfSingleRooms).map(room => room.roomId),
      ...availableRooms.filter((room) => room.roomType === "Double").slice(0, numOfDoubleRooms).map(room => room.roomId),
      ...availableRooms.filter((room) => room.roomType === "Suite").slice(0, numOfSuiteRooms).map(room => room.roomId)
    ];

    // Validate that the requested rooms are available
    if (allocatedRooms.length !== totalRoomsRequested) {
      return sendError(400, "Requested room types are not available.");
    }

    // Calculate the total price based on room types, number of nights, and room prices
    const nights = (new Date(checkOut) - new Date(checkIn)) / (1000 * 3600 * 24);
    const totalPrice = nights * (
      numOfSingleRooms * singleRoomPrice +
      numOfDoubleRooms * doubleRoomPrice +
      numOfSuiteRooms * suiteRoomPrice
    );

    // Prepare the update parameters for the booking, including the newly allocated rooms
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

    // Free up any previously booked rooms that are no longer needed
    const freeUpPreviousRooms = previousRooms
      .filter((roomId) => !allocatedRooms.includes(roomId))
      .map((roomId) => ({
        TableName: "bonzaiInventory",
        Key: { roomId },
        UpdateExpression: "set roomIsAvailable = :true",
        ExpressionAttributeValues: { ":true": true },
      }));

    // Mark the newly allocated rooms as unavailable in the inventory
    const updateRoomAvailability = allocatedRooms.map((roomId) => ({
      TableName: "bonzaiInventory",
      Key: { roomId },
      UpdateExpression: "set roomIsAvailable = :false",
      ExpressionAttributeValues: { ":false": false },
    }));

    // Perform all inventory updates (freeing up and marking rooms as unavailable) in parallel
    await Promise.all([
      ...freeUpPreviousRooms.map((params) => db.update(params)),
      ...updateRoomAvailability.map((params) => db.update(params)),
    ]);

    // Respond with success and the updated booking details
    return sendResponse({
      message: "Booking updated successfully.",
      updatedAttributes: result.Attributes,
    });
  } catch (error) {
    // Log any errors and return a 500 response
    console.error("Error updating booking:", error);
    return sendError(500, "Could not update booking.");
  }
};
