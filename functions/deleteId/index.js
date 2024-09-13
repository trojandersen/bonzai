const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");

exports.handler = async (event) => {
  const { id: bookingId } = event.pathParameters || {};

  if (!bookingId) {
    return sendError(400, { message: 'A Booking ID is required' });
  }

  try {
    // Fetch the booking to get roomIds
    const result = await db.get({
      TableName: 'bonzaiBookings',
      ConsistentRead: true,
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

    // Step 1: Set all roomIds in the booking to available
    const roomIds = result.Item.roomIds || [];
    if (roomIds.length > 0) {
      const freeRoomsPromises = roomIds.map((roomId) => {
        return db.update({
          TableName: 'bonzaiInventory',
          Key: { roomId },
          UpdateExpression: 'set roomIsAvailable = :true',
          ExpressionAttributeValues: { ':true': true }
        });
      });

      // Wait for all rooms to be marked as available
      await Promise.all(freeRoomsPromises);
    }

    // Step 2: Delete the booking
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
