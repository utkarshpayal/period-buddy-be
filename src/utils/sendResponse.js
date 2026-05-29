export const sendResponse = (res, statusCode, message, data = null, token = null) => {
  const response = {
    success: statusCode < 400,
    statusCode,
    message,
    ...(data && { data }),
    ...(token && { token }),
  };

  return res.status(statusCode).json(response);
};

export const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
};

export const sendValidationError = (res, errors) => {
  return res.status(422).json({
    success: false,
    statusCode: 422,
    message: 'Validation failed',
    errors: errors.map((error) => ({
      field: error.param,
      message: error.msg,
    })),
  });
};
