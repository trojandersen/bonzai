const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");
const { v4: uuid4 } = require("uuid");

// Function to validate if a date is in the correct YYYY-MM-DD format
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    return false;
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

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

  const allocatedRooms = [
    ...availableRooms.filter((room) => room.roomType === "Single").slice(0, numOfSingleRooms).map((room) => room.roomId),
    ...availableRooms.filter((room) => room.roomType === "Double").slice(0, numOfDoubleRooms).map((room) => room.roomId),
    ...availableRooms.filter((room) => room.roomType === "Suite").slice(0, numOfSuiteRooms).map((room) => room.roomId),
  ];

  return allocatedRooms;
}

// Utility function to update room inventory (free rooms and allocate rooms)
async function updateRoomInventory(freeRooms, allocateRooms) {
  const freeUpPreviousRooms = freeRooms.map((roomId) => ({
    TableName: "bonzaiInventory",
    Key: { roomId },
    UpdateExpression: "set roomIsAvailable = :true",
    ExpressionAttributeValues: { ":true": true },
  }));

  const markRoomsAsUnavailable = allocateRooms.map((roomId) => ({
    TableName: "bonzaiInventory",
    Key: { roomId },
    UpdateExpression: "set roomIsAvailable = :false",
    ExpressionAttributeValues: { ":false": false },
  }));

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

  return nights * (
    singleRooms * singleRoomPrice +
    doubleRooms * doubleRoomPrice +
    suiteRooms * suiteRoomPrice
  );
}

// Function to create a booking and save it to the database
async function postBooking(booking) {
  const bookingId = uuid4(); // Use uuid4() to generate a unique booking ID
  const params = {
    TableName: "bonzaiBookings",
    Item: {
      bookingId: bookingId,
      ...booking,
    },
  };
  await db.put(params);
  return bookingId;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    // Validate request parameters
    if (
      !body.name ||
      !body.email ||
      body.guests < 1 ||
      (body.numofSingleRooms < 1 &&
        body.numOfDoubleRooms < 1 &&
        body.numOfSuiteRooms < 1) ||
      !isValidDate(body.checkIn) ||
      !isValidDate(body.checkOut) ||
      new Date(body.checkIn) >= new Date(body.checkOut)
    ) {
      return sendError(400, "Invalid request parameters.");
    }

    // Validate the number of rooms does not exceed the number of guests
    const totalRoomsRequested = body.numofSingleRooms + body.numOfDoubleRooms + body.numOfSuiteRooms;
    if (totalRoomsRequested > body.guests) {
      return sendError(400, "Number of rooms cannot exceed number of guests.");
    }

    // Calculate total bed capacity based on room types
    const totalBedsAvailable = 
      body.numofSingleRooms * 1 + 
      body.numOfDoubleRooms * 2 + 
      body.numOfSuiteRooms * 2;

    // Validate the number of beds is enough for the guests
    if (body.guests > totalBedsAvailable) {
      return sendError(400, "Not enough beds for the number of guests.");
    }

    // Allocate rooms
    const allocatedRooms = await allocateRooms(
      body.numofSingleRooms,
      body.numOfDoubleRooms,
      body.numOfSuiteRooms
    );

    // Ensure all requested rooms are available
    if (allocatedRooms.length !== totalRoomsRequested) {
      return sendError(400, "Requested room types are not available.");
    }

    // Create the booking object
    const booking = {
      name: body.name,
      email: body.email,
      guests: body.guests,
      numofSingleRooms: body.numofSingleRooms,
      numOfDoubleRooms: body.numOfDoubleRooms,
      numOfSuiteRooms: body.numOfSuiteRooms,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      roomIds: allocatedRooms,
    };

    // Calculate the total price for the booking
    const totalPrice = calculateTotalPrice(
      body.numofSingleRooms,
      body.numOfDoubleRooms,
      body.numOfSuiteRooms,
      body.checkIn,
      body.checkOut
    );
    booking.totalPrice = totalPrice;

    // Save the booking in the database and get the bookingId
    const bookingId = await postBooking(booking);
    booking.bookingId = bookingId;

    // Update room availability in the inventory
    await updateRoomInventory([], allocatedRooms);

    // Send a success response
    return sendResponse({
      message: "Booking successful",
      bookingId: booking.bookingId,
      roomIds: booking.roomIds,
    });
  } catch (error) {
    return sendError(500, error.message || "An unexpected error occurred.");
  }
};
