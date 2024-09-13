const { sendResponse, sendError } = require("../../responses");
const { db } = require("../../services/db");

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
  if (checkIn < today) {
    return sendError(400, "Check-in date cannot be in the past.");
  }
  if (new Date(checkOut) <= new Date(checkIn)) {
    return sendError(400, "Check-out date must be after check-in date.");
  }

  // Calculate total beds available
  const totalBedsAvailable =
    numOfSingleRooms * 1 + numOfDoubleRooms * 2 + numOfSuiteRooms * 2;

  const totalRoomsRequested =
    numOfSingleRooms + numOfDoubleRooms + numOfSuiteRooms;

  // Validate guest count
  if (guests < totalRoomsRequested) {
    return sendError(
      400,
      "Number of guests cannot be less than the number of rooms booked."
    );
  }

  if (guests > totalBedsAvailable) {
    return sendError(
      400,
      "Number of guests exceeds the available number of beds."
    );
  }

  try {
    // Fetch the existing booking by ID
    const checkParams = {
      TableName: "bonzaiBookings",
      ConsistentRead: true,
      Key: { bookingId: id },
    };
    const existingBooking = await db.get(checkParams);
    if (!existingBooking.Item) {
      return sendError(404, "Booking not found.");
    }

    // Get previously allocated rooms
    const previousRooms = existingBooking.Item.rooms || [];

    // Separate previously booked rooms by type
    const previousSingleRooms = previousRooms.filter(roomId => roomId.startsWith('Single'));
    const previousDoubleRooms = previousRooms.filter(roomId => roomId.startsWith('Double'));
    const previousSuiteRooms = previousRooms.filter(roomId => roomId.startsWith('Suite'));

    // Check for available rooms, including previously booked rooms
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

    // Allocate Single rooms
    const singleRoomsNeeded = numOfSingleRooms - previousSingleRooms.length;
    const availableSingleRooms = availableRooms
      .filter(room => room.roomType === "Single")
      .slice(0, Math.max(singleRoomsNeeded, 0))
      .map(room => room.roomId);
    const allocatedSingleRooms = [...previousSingleRooms.slice(0, numOfSingleRooms), ...availableSingleRooms];

    // Allocate Double rooms
    const doubleRoomsNeeded = numOfDoubleRooms - previousDoubleRooms.length;
    const availableDoubleRooms = availableRooms
      .filter(room => room.roomType === "Double")
      .slice(0, Math.max(doubleRoomsNeeded, 0))
      .map(room => room.roomId);
    const allocatedDoubleRooms = [...previousDoubleRooms.slice(0, numOfDoubleRooms), ...availableDoubleRooms];

    // Allocate Suite rooms
    const suiteRoomsNeeded = numOfSuiteRooms - previousSuiteRooms.length;
    const availableSuiteRooms = availableRooms
      .filter(room => room.roomType === "Suite")
      .slice(0, Math.max(suiteRoomsNeeded, 0))
      .map(room => room.roomId);
    const allocatedSuiteRooms = [...previousSuiteRooms.slice(0, numOfSuiteRooms), ...availableSuiteRooms];

    const allocatedRooms = [
      ...allocatedSingleRooms,
      ...allocatedDoubleRooms,
      ...allocatedSuiteRooms,
    ];

    // Validate if we have enough rooms available for each type
    if (allocatedSingleRooms.length < numOfSingleRooms) {
      return sendError(
        400,
        `Not enough available Single rooms. Requested ${numOfSingleRooms}, but only ${allocatedSingleRooms.length} are available.`
      );
    }

    if (allocatedDoubleRooms.length < numOfDoubleRooms) {
      return sendError(
        400,
        `Not enough available Double rooms. Requested ${numOfDoubleRooms}, but only ${allocatedDoubleRooms.length} are available.`
      );
    }

    if (allocatedSuiteRooms.length < numOfSuiteRooms) {
      return sendError(
        400,
        `Not enough available Suite rooms. Requested ${numOfSuiteRooms}, but only ${allocatedSuiteRooms.length} are available.`
      );
    }

    // Calculate total price based on room types and number of nights
    const singleRoomPrice = 500,
      doubleRoomPrice = 1000,
      suiteRoomPrice = 1500;
    const nights = (new Date(checkOut) - new Date(checkIn)) / (1000 * 3600 * 24);
    const totalPrice =
      nights *
      (numOfSingleRooms * singleRoomPrice +
        numOfDoubleRooms * doubleRoomPrice +
        numOfSuiteRooms * suiteRoomPrice);

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

    // Free up previously booked rooms that are no longer needed
    const freeUpPreviousRooms = previousRooms
      .filter(roomId => !allocatedRooms.includes(roomId))  // If room is no longer allocated, free it
      .map(roomId => ({
        TableName: "bonzaiInventory",
        Key: { roomId },
        UpdateExpression: "set roomIsAvailable = :true",
        ExpressionAttributeValues: { ":true": true },
      }));

    // Mark newly allocated rooms as unavailable (except for previously allocated ones)
    const updateRoomAvailability = allocatedRooms
      .filter(roomId => !previousRooms.includes(roomId))  // Only mark newly booked rooms as unavailable
      .map(roomId => ({
        TableName: "bonzaiInventory",
        Key: { roomId },
        UpdateExpression: "set roomIsAvailable = :false",
        ExpressionAttributeValues: { ":false": false },
      }));

    // Perform inventory updates sequentially
    for (const params of [...freeUpPreviousRooms, ...updateRoomAvailability]) {
      await db.update(params);
    }

    // Respond with success and updated booking details
    return sendResponse({
      message: "Booking updated successfully.",
      updatedAttributes: result.Attributes,
    });
  } catch (error) {
    // Return unified error message
    return sendError(500, error.message || "An unexpected error occurred.");
  }
};
