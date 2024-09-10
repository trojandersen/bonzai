const { sendResponse } = require("../../responses/index");
const { db } = require("../../services/db");

exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Go Serverless v4! Your function executed successfully!",
    }),
  };
};
