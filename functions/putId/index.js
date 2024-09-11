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

  // Ensure the check-in date is today or later, and check-out is at least one night after check-in
  const today = new Date().toISOString().split("T")[0];
  if (checkIn < today || new Date(checkOut) <= new Date(checkIn)) {
    return sendError(400, "Invalid check-in/check-out dates.");
  }

  // Calculate number of beds requested
  const totalBedsAvailable =
    numOfSingleRooms * 1 + numOfDoubleRooms * 2 + numOfSuiteRooms * 2;

  // Validate guest-to-room ratio: Ensure there's at least one guest per room
  const totalRoomsRequested =
    numOfSingleRooms + numOfDoubleRooms + numOfSuiteRooms;
  if (guests < totalRoomsRequested) {
    return sendError(400, "Number of guests cannot be less than the number of rooms booked.");
  }

  // Validate bed-to-guest ratio: Ensure the total number of guests does not exceed the number of available beds
  if (guests > totalBedsAvailable) {
    return sendError(400, "Number of guests exceeds the available number of beds.");
  }

  try {
    // Check if the booking exists
    const checkParams = {
      TableName: "bonzaiBookings",
      Key: { bookingId: id },
    };
    const existingBooking = await db.get(checkParams);
    if (!existingBooking.Item) {
      return sendError(404, "Booking not found.");
    }

    const previousRooms = existingBooking.Item.rooms || [];

    // Query inventory to check for available rooms
    const inventoryCheckParams = {
      TableName: "bonzaiInventory",
      FilterExpression: "roomIsAvailable = :true OR roomId IN (:previousRooms)",
      ExpressionAttributeValues: {
        ":true": true,
        ":previousRooms": previousRooms,  // Include previously booked rooms so they can be reallocated if needed
      },
    };
    const inventory = await db.scan(inventoryCheckParams);
    const availableRooms = inventory.Items;

    // Count available rooms by type
    const availableSingleRooms = availableRooms.filter(
      (room) => room.roomType === "Single"
    );
    const availableDoubleRooms = availableRooms.filter(
      (room) => room.roomType === "Double"
    );
    const availableSuiteRooms = availableRooms.filter(
      (room) => room.roomType === "Suite"
    );

    // Validate room availability
    if (
      numOfSingleRooms > availableSingleRooms.length ||
      numOfDoubleRooms > availableDoubleRooms.length ||
      numOfSuiteRooms > availableSuiteRooms.length
    ) {
      return sendError(400, "Requested room types are not available.");
    }

    // Allocate rooms
    const allocatedRooms = [
      ...availableSingleRooms.slice(0, numOfSingleRooms).map(room => room.roomId),
      ...availableDoubleRooms.slice(0, numOfDoubleRooms).map(room => room.roomId),
      ...availableSuiteRooms.slice(0, numOfSuiteRooms).map(room => room.roomId)
    ];

    // Calculate total price based on room types and number of nights
    const singleRoomPrice = 500;
    const doubleRoomPrice = 1000;
    const suiteRoomPrice = 1500;
    const nights = (new Date(checkOut) - new Date(checkIn)) / (1000 * 3600 * 24);
    const totalPrice =
      nights *
      (numOfSingleRooms * singleRoomPrice +
        numOfDoubleRooms * doubleRoomPrice +
        numOfSuiteRooms * suiteRoomPrice);

    // Prepare the update expression and attribute values for the fields that are allowed to change
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
        ":rooms": allocatedRooms, // Store allocated room IDs
      },
      ReturnValues: "UPDATED_NEW",
    };

    // Update the booking
    const result = await db.update(params);

    // Free previously booked rooms if they are no longer needed
    const freeUpPreviousRooms = async (previousRooms) => {
      for (const roomId of previousRooms) {
        if (!allocatedRooms.includes(roomId)) {
          const roomUpdateParams = {
            TableName: "bonzaiInventory",
            Key: { roomId },
            UpdateExpression: "set roomIsAvailable = :true",
            ExpressionAttributeValues: {
              ":true": true,
            },
          };
          await db.update(roomUpdateParams);
        }
      }
    };

    // Update room availability
    const updateRoomAvailability = async (roomType, numOfRooms, allocatedRoomIds) => {
      const roomsToUpdate = availableRooms
        .filter((room) => room.roomType === roomType && allocatedRoomIds.includes(room.roomId));

      for (const room of roomsToUpdate) {
        const roomUpdateParams = {
          TableName: "bonzaiInventory",
          Key: { roomId: room.roomId },
          UpdateExpression: "set roomIsAvailable = :false",
          ExpressionAttributeValues: {
            ":false": false,
          },
        };
        await db.update(roomUpdateParams);
      }
    };

    await Promise.all([
      freeUpPreviousRooms(previousRooms),
      updateRoomAvailability("Single", numOfSingleRooms, allocatedRooms),
      updateRoomAvailability("Double", numOfDoubleRooms, allocatedRooms),
      updateRoomAvailability("Suite", numOfSuiteRooms, allocatedRooms),
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
