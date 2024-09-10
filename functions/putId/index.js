const { sendResponse, sendError } = require("../../responses");
const { db } = require("../../services/db");

exports.handler = async (event) => {
  const { id } = event.pathParameters;
  const { guests, numOfRooms, roomType, checkIn, checkOut } = JSON.parse(event.body);

  // Prepare the update expression and attribute values for the fields that are allowed to change
  const params = {
    TableName: "bonzaiBookings",
    Key: { bookingId: id },
    UpdateExpression: "set guests = :guests, numOfRooms = :numOfRooms, roomType = :roomType, checkIn = :checkIn, checkOut = :checkOut",
    ExpressionAttributeValues: {
      ":guests": guests,
      ":numOfRooms": numOfRooms,
      ":roomType": roomType,
      ":checkIn": checkIn,
      ":checkOut": checkOut,
    },
    ReturnValues: "UPDATED_NEW",
  };

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

    // Update the allowed fields
    const result = await db.update(params);
    return sendResponse({
      message: "Booking updated successfully.",
      updatedAttributes: result.Attributes,
    });
  } catch (error) {
    return sendError(500, "Could not update booking.");
  }
};
