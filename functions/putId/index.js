const { sendResponse, sendError } = require("../../responses");
const { db } = require("../../services/db");

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

  const today = new Date().toISOString().split("T")[0];
  if (checkIn < today || new Date(checkOut) <= new Date(checkIn)) {
    return sendError(400, "Invalid check-in/check-out dates.");
  }

  const totalBedsAvailable =
    numOfSingleRooms * 1 + numOfDoubleRooms * 2 + numOfSuiteRooms * 2;

  const totalRoomsRequested =
    numOfSingleRooms + numOfDoubleRooms + numOfSuiteRooms;
  if (guests < totalRoomsRequested) {
    return sendError(400, "Number of guests cannot be less than the number of rooms booked.");
  }

  if (guests > totalBedsAvailable) {
    return sendError(400, "Number of guests exceeds the available number of beds.");
  }

  try {
    const checkParams = {
      TableName: "bonzaiBookings",
      Key: { bookingId: id },
    };
    const existingBooking = await db.get(checkParams);
    if (!existingBooking.Item) {
      return sendError(404, "Booking not found.");
    }

    const previousRooms = existingBooking.Item.rooms || [];

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

    const singleRoomPrice = 500, doubleRoomPrice = 1000, suiteRoomPrice = 1500;

    const allocatedRooms = [
      ...availableRooms.filter((room) => room.roomType === "Single").slice(0, numOfSingleRooms).map(room => room.roomId),
      ...availableRooms.filter((room) => room.roomType === "Double").slice(0, numOfDoubleRooms).map(room => room.roomId),
      ...availableRooms.filter((room) => room.roomType === "Suite").slice(0, numOfSuiteRooms).map(room => room.roomId)
    ];

    if (allocatedRooms.length !== totalRoomsRequested) {
      return sendError(400, "Requested room types are not available.");
    }

    const nights = (new Date(checkOut) - new Date(checkIn)) / (1000 * 3600 * 24);
    const totalPrice = nights * (
      numOfSingleRooms * singleRoomPrice +
      numOfDoubleRooms * doubleRoomPrice +
      numOfSuiteRooms * suiteRoomPrice
    );

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

    const result = await db.update(params);

    const freeUpPreviousRooms = previousRooms
      .filter((roomId) => !allocatedRooms.includes(roomId))
      .map((roomId) => ({
        TableName: "bonzaiInventory",
        Key: { roomId },
        UpdateExpression: "set roomIsAvailable = :true",
        ExpressionAttributeValues: { ":true": true },
      }));

    const updateRoomAvailability = allocatedRooms.map((roomId) => ({
      TableName: "bonzaiInventory",
      Key: { roomId },
      UpdateExpression: "set roomIsAvailable = :false",
      ExpressionAttributeValues: { ":false": false },
    }));

    await Promise.all([
      ...freeUpPreviousRooms.map((params) => db.update(params)),
      ...updateRoomAvailability.map((params) => db.update(params)),
    ]);

    return sendResponse({
      message: "Booking updated successfully.",
      updatedAttributes: result.Attributes,
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    return sendError(500, "Could not update booking.");
  }
};
