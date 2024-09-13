# Bonzai - Gruppexam in "Development & deployment in a cloud environment"


## Description of assignment

“Bonz.ai, the company behind the hotel, has always strived to be at the forefront when it comes to using technology to enhance the customer experience. They have a strong culture of innovation and are not afraid to think outside the box.

You have been hired to build their booking API, and for this project, a serverless architecture in AWS was chosen. This means you don’t need to worry about managing or maintaining servers. Instead, you can focus on building and improving your application. Additionally, the serverless architecture allows Bonz.ai to scale up or down based on demand, which is perfect for their booking system that may experience varying traffic at different times of the day or year. ☁️

To store all booking information, DynamoDB was chosen, a NoSQL database offered by AWS. DynamoDB is an excellent choice for their booking API because it offers fast and predictable performance, as well as automatic scaling.”


## Technical requirements
- **Serverless framework**
- **API Gateway**
- **AWS Lambda**
- **DynamoDB**


## Table of Contents

1. [API Endpoints](#api-endpoints)
2. [Installation and Running the Project](#installation-and-running-the-project)
3. [Error Handling](#error-handling)
4. [Instructions](#instructions)

## API Endpoints

### Endpoints

| Method | Endpoint | Description | 
| ------ | -------- | ----------- | 
| GET    | /bookings | Overview of the bookings for receptionist | 
| POST   | /bookings | Make a hotel reservation | 
| PUT    | /bookings/:id | Make changes to a reservation | 
| DELETE | /bookings/:id | Delete a reservation | 


## Installation and Running the Project

Follow these steps to create a local copy and run the project:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/trojandersen/bonzai.git

2. Navigate to the project directory:
   ```bash
   cd bonzai

3. Install dependencies:
   ```bash
   npm install

4. Change the yml-file so that it connects to your AWS development service:
   ```bash
   org: *name-of-your-org*

5. In order to deploy the project you need to open the terminal and enter the following command:
   ```bash
   sls deploy

5. After deployment you should se similar:
  ```
  endpoints:
  GET - https://xxxxxxxxxxxxx.execute-api.eu-north-1.amazonaws.com/bookings
  POST - https://xxxxxxxxxxxxx.execute-api.eu-north-1.amazonaws.com/bookings
  PUT - https://xxxxxxxxxxxxx.execute-api.eu-north-1.amazonaws.com/bookings/{id}
  DELETE - https://xxxxxxxxxxxxx.execute-api.eu-north-1.amazonaws.com/bookings/{id}
functions:
  getBooking: bonzai-dev-getBooking (10 kB)
  postBooking: bonzai-dev-postBooking (10 kB)
  putId: bonzai-dev-putId (10 kB)
  deleteId: bonzai-dev-deleteId (10 kB)
  ```


## Error handling

Common errors and their handling mechanisms are as follows:

- **400 Bad Request:** Invalid input format or missing parameters.
- **401 Unauthorized:** Invalid or missing authentication token.
- **403 Forbidden:** Insufficient privileges to access the resource.
- **404 Not Found:** Requested resource does not exist.
- **500 Internal Server Error:** General server error.

## Instructions
### As a receptionist you want to get an overview over the bookings:
   ```http
   GET /bookings
   ```
Response:
   ```json
   {
	"data": {
		"bookings": [
			{
				"bookingId": "64352643",
				"checkIn": "2024-09-13",
				"checkOut": "2024-09-17",
				"guests": 1,
				"name": "Paloma Wool",
				"numOfSingleRooms": 1
			},
			{
				"bookingId": "98745678",
				"checkIn": "2024-09-13",
				"checkOut": "2024-09-15",
				"guests": 4,
				"name": "Gwen Stefanie",
				"numOfDoubleRooms": 2
			}
		]
	}
}
   ```


### Making a reservation 
   ```http
   POST /bookings
   ```
Request syntax:
  ```json
   {
    "name": "Jose Gonzalez",
    "email": "jg@gmail.com",
    "guests": 1,
    "numOfSingleRooms": 1,
    "numOfDoubleRooms": 0,
    "numOfSuiteRooms": 0,
    "checkIn": "2024-09-13",
    "checkOut": "2024-09-16"
  }
   ```

Response:
   ```json
  {
  "bookingId": 876875,
  "name": "Jose Gonzalez",
  "guests": 1,
  "numOfSingleRooms": 1,
  "numOfDoubleRooms": 0,
  "numOfSuiteRooms": 0,
  "checkIn": "2024-09-13",
  "checkOut": "2024-09-16",
  "totalPrice": 1500
  }
   ```


   ### Error handling

   **400 Bad request** EToo many guests per room: 
   ```json
   {
	"errorMessage": "Number of guests exceeds the available number of beds."
   }
   ```
   **400 Bad request** Missing fields: 
   ```json
   {
	"errorMessage": "Missing required fields in the request body."
   }
   ```
   **500 Bad request** Insufficient rooms:
   ```json
   {
	"errorMessage": "Not enough available Suite rooms."
   }
   ```

### Changings a reservation
Instructions: Here you need the `bookingId`and use it in the parapath parameter:
   ```http
   PUT /bookings/:id
   ```
Request syntax:
   ```json
   {
  "guests": 1,
  "numOfSingleRooms": 1,
  "numOfDoubleRooms": 0,
  "numOfSuiteRooms": 0,
  "checkIn": "2024-09-13", //date cannot be after check-in 
  "checkOut": "2024-09-19"
  }
   ```

Response if reservation was successful:
   ```json
{
	"data": {
		"message": "Booking updated successfully.",
		"updatedAttributes": {
			"checkIn": "2024-09-13",
			"numOfDoubleRooms": 0,
			"totalPrice": 1000,
			"guests": 1,
			"checkOut": "2024-09-15",
			"numOfSingleRooms": 1,
			"rooms": [
				"101"
			],
			"numOfSuiteRooms": 0
		}
	}
}

   **Error handling**
   ```
   **404 Not found** If bookingId does not exists in bookings table:
   ```json
   {
	"errorMessage": "Booking not found."
}
   ```
   **400 Bad request** EToo many guests per room: 
   ```json
   {
	"errorMessage": "Number of guests exceeds the available number of beds."
   }
   ```
   **400 Bad request** Missing fields: 
   ```json
   {
	"errorMessage": "Missing required fields in the request body."
   }
   ```
   **500 Bad request** Insufficient rooms:
   ```json
   {
	"errorMessage": "Not enough available Suite rooms."
   }
   ```

### Delete reservation:
Instructions: Here you need the `bookingId`and use it in the parapath parameter:
   ```http
   DELETE /bookings/:id
   ```

Response if something is in cart:
   ```json
   {
  "message": "Booking successfully deleted!"
  }
   ```

### Error handling

**400 Bad request** If todays date is less than two days before check-in
   ```json
   {
	"errorMessage": {
		"message": "Booking can only be cancelled up to 2 days before check-in date"
	}
   }
   ```

**404 Bad request** If bookingId is incorrect
   ```json
{
	"errorMessage": {
		"message": "Booking not found"
	}
}
   ```

