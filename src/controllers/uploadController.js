import { sendResponse, sendError } from '../utils/sendResponse.js';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { uploadBufferToS3 } from '../utils/s3.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';

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

    try {
      assertAllowedUpload(req.file.buffer, ['image', 'video', 'audio']);
    } catch (validationError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, validationError.message);
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

const CONTENT_MEDIA_FOLDERS = ['reels', 'audio', 'thumbnails'];

/**
 * Content-admin upload (reel video, guide audio, thumbnail/cover image).
 * Namespaces every object under `content/<userId>/<folder>` so uploads from
 * different admins land in their own S3 prefix and can be traced back to
 * whoever uploaded them.
 */
export const uploadContentMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.NO_FILE_UPLOADED);
    }

    try {
      assertAllowedUpload(req.file.buffer, ['image', 'video', 'audio']);
    } catch (validationError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, validationError.message);
    }

    const requestedFolder = (req.body.folder || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const folder = CONTENT_MEDIA_FOLDERS.includes(requestedFolder) ? requestedFolder : 'uploads';

    const { url, key } = await uploadBufferToS3({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      folder: `content/${req.userId}/${folder}`,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, SUCCESS_MESSAGES.FILE_UPLOADED, { url, key });
  } catch (error) {
    next(error);
  }
};
