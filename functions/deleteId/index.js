const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");

exports.handler = async (event) => {
  const { id: bookingId } = event.pathParameters || {};

  if (!bookingId) {
    return sendError(400, { message: 'A Booking ID is required' });
  }

  try {
    const result = await db.get({
      TableName: 'bonzaiBookings',
      Key: { bookingId }
    });

    if (!result.Item) {
      return sendError(404, { message: 'Booking not found' });
    }

    const checkInDate = new Date(result.Item.checkIn);
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    const dayDifference = Math.ceil((checkInDate - currentDate) / (1000 * 60 * 60 * 24));

    if (dayDifference <= 2) {
      return sendError(400, { message: 'Booking can only be cancelled up to 2 days before check-in date' });
    }

    await db.delete({
      TableName: 'bonzaiBookings',
      Key: { bookingId }
    });

    return sendResponse({ message: 'Booking successfully deleted' });

  } catch (error) {
    console.error('Error deleting booking:', error);
    return sendError(500, { message: 'Could not delete Booking' });
  }
};