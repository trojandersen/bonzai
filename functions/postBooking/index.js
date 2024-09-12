const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");
const { v4: uuid4 } = require("uuid");

// function that queries the inventory table for roomType and its availability
async function getAvailableRoom(roomType) {
  const params = {
    TableName: "bonzaiInventory",
    FilterExpression:
      "roomType = :roomType AND roomIsAvailable = :roomIsAvailable",
    ExpressionAttributeValues: {
      ":roomType": roomType,
      ":roomIsAvailable": true,
    },
  };

  const result = await db.scan(params);
  return result.Items.length > 0 ? result.Items[0] : null;
}

// here we update roomIsAvailable to false if the room is booked
async function updateRoomAvailability(roomId) {
  const params = {
    TableName: "bonzaiInventory",
    Key: {
      roomId: roomId,
    },
    UpdateExpression: "set roomIsAvailable = :roomIsAvailable",
    ExpressionAttributeValues: {
      ":roomIsAvailable": false,
    },
  };

  await db.update(params);
  return roomId;
}

// this function checks uses the two functions above to check for a room and change the boolean value to false and returns the roomId
async function assignRooms(roomType, numOfRooms) {
  const roomIds = [];

  for (let i = 0; i < numOfRooms; i++) {
    const availableRoom = await getAvailableRoom(roomType);
    if (availableRoom) {
      roomIds.push(availableRoom.roomId);
      await updateRoomAvailability(availableRoom.roomId);
    } else {
      throw new Error(`No available ${roomType} rooms.`);
    }
  }

  return roomIds;
}

// Function that creates and puts the booking into our db
async function postBooking(booking) {
  const bookingId = uuid4();
  const params = {
    TableName: "bonzaiBookings",
    Item: {
      bookingId: bookingId,
      name: booking.name,
      email: booking.email,
      guests: booking.guests,
      numofSingleRooms: booking.numofSingleRooms,
      numOfDoubleRooms: booking.numOfDoubleRooms,
      numOfSuiteRooms: booking.numOfSuiteRooms,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      roomIds: booking.roomIds,
    },
  };
  await db.put(params);
  return bookingId;
}

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

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    // Validating the body
    if (
      !body.name ||
      !body.email ||
      body.guests < 1 ||
      (body.numofSingleRooms < 1 &&
        body.numOfDoubleRooms < 1 &&
        body.numOfSuiteRooms < 1) ||
      !isValidDate(body.checkIn) ||
      !isValidDate(body.checkOut)
    ) {
      return sendError(400, "Missing required fields in the request body.");
    }

    // Assign rooms of each type
    const singleRoomIds = await assignRooms("Single", body.numofSingleRooms);
    const doubleRoomIds = await assignRooms("Double", body.numOfDoubleRooms);
    const suiteRoomIds = await assignRooms("Suite", body.numOfSuiteRooms);

    // Then we add them together into one array
    const roomIds = [...singleRoomIds, ...doubleRoomIds, ...suiteRoomIds];

    const booking = {
      name: body.name,
      email: body.email,
      guests: body.guests,
      numofSingleRooms: body.numofSingleRooms,
      numOfDoubleRooms: body.numOfDoubleRooms,
      numOfSuiteRooms: body.numOfSuiteRooms,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      roomIds: roomIds, // We add the roomIds array to the booking object
    };

    // Save the booking in the database
    // await postBooking(booking);
    
    // Save the booking in the database and get the bookingId
    const bookingId = await postBooking(booking);

    // Add bookingId to the booking object
    booking.bookingId = bookingId;

    return sendResponse({
      message: "Booking successful",
      bookingId: booking.bookingId,
      roomIds: booking.roomIds,
    });
  } catch (error) {
    return sendError(500, error.message || "An unexpected error occured.");
  }
};
