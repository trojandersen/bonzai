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
    numOfSingleRooms * 1 + numOfDoubleRooms * 2 + numOfSuiteRooms * 3;

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

    // Get previously allocated roomIds
    const previousRooms = existingBooking.Item.roomIds || [];

    // Step 1: Mark all previously booked rooms as available
    const freePreviousRooms = previousRooms.map((roomId) => ({
      TableName: "bonzaiInventory",
      Key: { roomId },
      UpdateExpression: "set roomIsAvailable = :true",
      ExpressionAttributeValues: { ":true": true },
    }));

    // Free up all previously booked rooms
    for (const params of freePreviousRooms) {
      await db.update(params); // Wait until all rooms are freed
    }

    // Step 2: Fetch the inventory of rooms (now including previously booked rooms)
    const inventoryCheckParams = {
      TableName: "bonzaiInventory",
      FilterExpression: "roomIsAvailable = :true",
      ExpressionAttributeValues: {
        ":true": true,
      },
    };
    const inventory = await db.scan(inventoryCheckParams);
    const availableRooms = inventory.Items;

    // Allocate Single rooms
    const availableSingleRooms = availableRooms
      .filter((room) => room.roomType === "Single")
      .slice(0, numOfSingleRooms)
      .map((room) => room.roomId);

    // Allocate Double rooms
    const availableDoubleRooms = availableRooms
      .filter((room) => room.roomType === "Double")
      .slice(0, numOfDoubleRooms)
      .map((room) => room.roomId);

    // Allocate Suite rooms
    const availableSuiteRooms = availableRooms
      .filter((room) => room.roomType === "Suite")
      .slice(0, numOfSuiteRooms)
      .map((room) => room.roomId);

    // Combine the allocated roomIds
    const allocatedRooms = [
      ...availableSingleRooms,
      ...availableDoubleRooms,
      ...availableSuiteRooms,
    ];

    // Step 3: Validate if we have enough rooms available for each type
    if (availableSingleRooms.length < numOfSingleRooms) {
      return sendError(
        400,
        `Not enough available Single rooms. Requested ${numOfSingleRooms}, but only ${availableSingleRooms.length} are available.`
      );
    }

    if (availableDoubleRooms.length < numOfDoubleRooms) {
      return sendError(
        400,
        `Not enough available Double rooms. Requested ${numOfDoubleRooms}, but only ${availableDoubleRooms.length} are available.`
      );
    }

    if (availableSuiteRooms.length < numOfSuiteRooms) {
      return sendError(
        400,
        `Not enough available Suite rooms. Requested ${numOfSuiteRooms}, but only ${availableSuiteRooms.length} are available.`
      );
    }

    // Step 4: Calculate total price based on room types and number of nights
    const singleRoomPrice = 500,
      doubleRoomPrice = 1000,
      suiteRoomPrice = 1500;
    const nights =
      (new Date(checkOut) - new Date(checkIn)) / (1000 * 3600 * 24);
    const totalPrice =
      nights *
      (numOfSingleRooms * singleRoomPrice +
        numOfDoubleRooms * doubleRoomPrice +
        numOfSuiteRooms * suiteRoomPrice);

    // Step 5: Prepare update parameters for the booking
    const params = {
      TableName: "bonzaiBookings",
      Key: { bookingId: id },
      UpdateExpression:
        "set guests = :guests, numOfSingleRooms = :numOfSingleRooms, numOfDoubleRooms = :numOfDoubleRooms, numOfSuiteRooms = :numOfSuiteRooms, checkIn = :checkIn, checkOut = :checkOut, totalPrice = :totalPrice, roomIds = :roomIds",
      ExpressionAttributeValues: {
        ":guests": guests,
        ":numOfSingleRooms": numOfSingleRooms,
        ":numOfDoubleRooms": numOfDoubleRooms,
        ":numOfSuiteRooms": numOfSuiteRooms,
        ":checkIn": checkIn,
        ":checkOut": checkOut,
        ":totalPrice": totalPrice,
        ":roomIds": allocatedRooms, // Updated room allocation
      },
      ReturnValues: "UPDATED_NEW",
    };

    // Step 6: Update the booking in the database
    const result = await db.update(params);

    // Step 7: Mark all newly booked rooms as unavailable
    const updateRoomAvailability = allocatedRooms.map((roomId) => ({
      TableName: "bonzaiInventory",
      Key: { roomId },
      UpdateExpression: "set roomIsAvailable = :false",
      ExpressionAttributeValues: { ":false": false },
    }));

    // Mark all newly booked rooms as unavailable
    for (const params of updateRoomAvailability) {
      await db.update(params);
    }

    // Step 8: Respond with success and updated booking details
    return sendResponse({
      message: "Booking updated successfully.",
      updatedAttributes: result.Attributes,
    });
  } catch (error) {
    // Return unified error message
    return sendError(500, error.message || "An unexpected error occurred.");
  }
};
