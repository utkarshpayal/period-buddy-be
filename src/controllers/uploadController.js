import { sendResponse, sendError } from '../utils/sendResponse.js';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { uploadBufferToS3 } from '../utils/s3.js';

/**
 * Generic authenticated file upload — used for profile pictures and any
 * other user-uploaded media (e.g. community post images). The `folder`
 * query/body param namespaces objects within the bucket.
 */
export const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.NO_FILE_UPLOADED);
    }

    const folder = (req.body.folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '');

    const { url, key } = await uploadBufferToS3({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      folder: folder || 'uploads',
    });

    return sendResponse(res, HTTP_STATUS.CREATED, SUCCESS_MESSAGES.FILE_UPLOADED, { url, key });
  } catch (error) {
    next(error);
  }
};
