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
          name: booking.name
      }

      // Conditionally add room types only if their value is greater than 0
      if (booking.numofSingleRooms > 0) {
        formattedBooking.numOfSingleRooms = booking.numofSingleRooms;
      }
      if (booking.numOfDoubleRooms > 0) {
        formattedBooking.numOfDoubleRooms = booking.numOfDoubleRooms;
      }
      if (booking.numOfSuiteRooms > 0) {
        formattedBooking.numOfSuiteRooms = booking.numOfSuiteRooms;
      }


      formattedData.bookings.push(formattedBooking)
      })
      
      return sendResponse(formattedData)
  } catch (error) {
    
      return sendError(500, error)
  }
  
};