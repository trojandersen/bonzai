const { sendResponse, sendError } = require("../../responses/index");
const { db } = require("../../services/db");


const formattedData = {
  bookings: []
};

module.exports.handler = async (event) => {

  try {
      const data = await db.scan({
          TableName: 'bonzaiBookings'
      })

      data.Items.forEach(booking => {
        const formattedBooking = {
          bookingId: booking.bookingId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guests: booking.guests,
          numOfRooms: booking.roomId.split(', ').length,  // Count number of rooms
          name: booking.name
      }
      formattedData.bookings.push(formattedBooking)
      })
      
      return sendResponse(formattedData)
  } catch (error) {
    
      return sendError(500, error)
  }
  
};