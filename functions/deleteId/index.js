const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");

exports.handler = async (event) => {
  const { id: bookingId } = event.pathParameters || {};

  if (!bookingId) {
    return sendError(400, { message: 'A Booking ID is required' });
  }

  try {
    // Check if the booking exists
    const getParams = {
      TableName: 'bonzaiBookings',
      Key: { bookingId }
    };

    const result = await db.get(getParams);

    if (!result.Item) {
      // Booking ID does not exist
      return sendError(404, { message: 'Booking not found' });
    }

    // Booking exists, delete booking
    await db.delete({
      TableName: 'bonzaiBookings',
      Key: { bookingId }
    });

    return sendResponse(200, { message: 'Booking successfully deleted' });

  } catch (error) {
    console.error('Error deleting booking:', error);
    return sendError(500, { message: 'Could not delete Booking' });
  }
};