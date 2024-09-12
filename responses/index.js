function sendResponse(statusCode, data) {
  return {
    statusCode: statusCode,
    body: JSON.stringify({
      data,
    }),
  };
}

function sendError(statusCode, errorMessage) {
  return {
    statusCode: statusCode,
    body: JSON.stringify({ error: errorMessage }),
  };
}

module.exports = { sendResponse, sendError };
