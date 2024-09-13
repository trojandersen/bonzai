const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");
const { v4: uuid4 } = require("uuid");

// Function that queries the inventory table for roomType and availability
async function getAvailableRooms(roomType) {
  const params = {
    TableName: "bonzaiInventory",
    ConsistentRead: true,
    FilterExpression:
      "roomType = :roomType AND roomIsAvailable = :roomIsAvailable",
    ExpressionAttributeValues: {
      ":roomType": roomType,
      ":roomIsAvailable": true,
    },
  };

  const result = await db.scan(params);
  return result.Items;
}

// Function that updates room availability to false
async function updateRoomAvailability(roomId) {
  const params = {
    TableName: "bonzaiInventory",
    Key: { roomId },
    UpdateExpression: "set roomIsAvailable = :roomIsAvailable",
    ExpressionAttributeValues: { ":roomIsAvailable": false },
  };
  await db.update(params);
}

// Function to assign rooms based on room type and availability
async function assignRooms(roomType, numOfRooms) {
  const availableRooms = await getAvailableRooms(roomType);

  if (availableRooms.length < numOfRooms) {
    throw new Error(`Not enough available ${roomType} rooms.`);
  }

  const assignedRooms = availableRooms.slice(0, numOfRooms).map(room => room.roomId);
  
  // Mark the assigned rooms as unavailable
  await Promise.all(
    assignedRooms.map(roomId => updateRoomAvailability(roomId))
  );

  return assignedRooms;
}

// Function to calculate total number of nights between check-in and check-out
function calculateNights(checkIn, checkOut) {
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const timeDiff = checkOutDate - checkInDate;
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
}

// Function to calculate the total price based on room types and nights
function calculateTotalPrice(numOfSingleRooms, numOfDoubleRooms, numOfSuiteRooms, nights) {
  const singleRoomPrice = 500;
  const doubleRoomPrice = 1000;
  const suiteRoomPrice = 1500;

  return (
    numOfSingleRooms * singleRoomPrice +
    numOfDoubleRooms * doubleRoomPrice +
    numOfSuiteRooms * suiteRoomPrice
  ) * nights;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    // Validating the body
    if (
      !body.name ||
      !body.email ||
      body.guests < 1 ||
      (body.numOfSingleRooms < 1 &&
        body.numOfDoubleRooms < 1 &&
        body.numOfSuiteRooms < 1) ||
      !isValidDate(body.checkIn) ||
      !isValidDate(body.checkOut)
    ) {
      return sendError(400, "Missing required fields in the request body.");
    }

    // Calculate total available beds based on room types
    const totalBedsAvailable =
      body.numOfSingleRooms * 1 + body.numOfDoubleRooms * 2 + body.numOfSuiteRooms * 2;

    // Ensure the number of guests does not exceed the total number of available beds
    if (body.guests > totalBedsAvailable) {
      return sendError(400, "Number of guests exceeds the available number of beds.");
    }

    // Ensure the number of guests is at least equal to the total number of rooms booked
    const totalRoomsRequested =
      body.numOfSingleRooms + body.numOfDoubleRooms + body.numOfSuiteRooms;
    if (body.guests < totalRoomsRequested) {
      return sendError(400, "Number of guests cannot be less than the number of rooms booked.");
    }

    // Calculate the number of nights
    const nights = calculateNights(body.checkIn, body.checkOut);

    // Calculate total price based on room types and number of nights
    const totalPrice = calculateTotalPrice(
      body.numOfSingleRooms,
      body.numOfDoubleRooms,
      body.numOfSuiteRooms,
      nights
    );

    // Assign rooms of each type
    const singleRoomIds = await assignRooms("Single", body.numOfSingleRooms);
    const doubleRoomIds = await assignRooms("Double", body.numOfDoubleRooms);
    const suiteRoomIds = await assignRooms("Suite", body.numOfSuiteRooms);

    // Combine room IDs into one array
    const roomIds = [...singleRoomIds, ...doubleRoomIds, ...suiteRoomIds];

    // Create booking object
    const booking = {
      bookingId: uuid4(),
      name: body.name,
      email: body.email,
      guests: body.guests,
      numOfSingleRooms: body.numOfSingleRooms,
      numOfDoubleRooms: body.numOfDoubleRooms,
      numOfSuiteRooms: body.numOfSuiteRooms,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      roomIds: roomIds,
      totalPrice: totalPrice, // Add totalPrice to the booking object
    };

    // Save booking in the database
    const params = {
      TableName: "bonzaiBookings",
      Item: booking,
    };
    await db.put(params);

    // Return successful response with booking details
    return sendResponse({
      message: "Booking successful",
      bookingId: booking.bookingId,
      roomIds: booking.roomIds,
      totalPrice: booking.totalPrice, // Return totalPrice in the response
    });
  } catch (error) {
    return sendError(500, error.message || "An unexpected error occurred.");
  }
};

// regex function for a date format
function isValidDate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    return false;
  }
  // Parse the date parts and validate the date
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}
