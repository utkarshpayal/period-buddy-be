import CompanyAsset, { COMPANY_ASSET_CATEGORIES } from '../models/CompanyAsset.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { uploadBufferToS3, deleteFromS3, getSignedDownloadUrl } from '../utils/s3.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  normalizeBoolean,
  pickDefined,
} from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import logger from '../utils/logger.js';

const S3_FOLDER = 'company-assets';
const WRITABLE_FIELDS = ['title', 'description', 'category'];

const isHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * POST /api/company-assets — upload a file straight to S3 and create its
 * library record in one step (admin only). Mirrors the medical-document
 * upload flow, but for company collateral: pitch decks, flow diagrams,
 * brand assets, policies, etc.
 */
export const uploadAsset = async (req, res, next) => {
  try {
    if (!req.file) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No file was uploaded');
    }

    const title = (req.body.title || req.file.originalname || 'Untitled').trim().slice(0, 150);
    const description = (req.body.description || '').trim().slice(0, 1000);
    const category = COMPANY_ASSET_CATEGORIES.includes(req.body.category)
      ? req.body.category
      : 'other';
    const isPublic = normalizeBoolean(req.body.isPublic, false);

    // The client-declared mimetype is spoofable — confirm the real bytes
    // match a type we're willing to serve back out of the bucket.
    let detectedType;
    try {
      detectedType = assertAllowedUpload(req.file.buffer, ['image', 'pdf', 'video', 'office']);
    } catch (validationError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, validationError.message);
    }

    const { url, key } = await uploadBufferToS3({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || detectedType,
      originalName: req.file.originalname,
      folder: S3_FOLDER,
    });

    const asset = await CompanyAsset.create({
      title: title || 'Untitled',
      description,
      category,
      fileUrl: url,
      fileKey: key,
      mimeType: req.file.mimetype || detectedType,
      originalFileName: req.file.originalname,
      fileSize: req.file.size,
      isPublic,
      uploadedBy: req.userId,
    });

    logger.info(`Admin ${req.userId} uploaded company asset ${asset._id}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COMPANY_ASSET_UPLOADED,
      resourceType: 'companyAsset',
      resourceId: asset._id,
      metadata: { title: asset.title, category: asset.category },
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'File uploaded successfully', { asset });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/company-assets/link — add a pointer to something hosted
 * elsewhere (Google Drive, Figma, Notion, YouTube, ...) instead of a file
 * uploaded to our own S3 bucket. Lives in the same library/list as uploads.
 */
export const createLinkAsset = async (req, res, next) => {
  try {
    const title = (req.body.title || '').trim().slice(0, 150);
    if (!title) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A title is required');
    }
    if (!isHttpUrl(req.body.linkUrl)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid http(s) URL is required');
    }

    const description = (req.body.description || '').trim().slice(0, 1000);
    const category = COMPANY_ASSET_CATEGORIES.includes(req.body.category)
      ? req.body.category
      : 'other';
    const isPublic = normalizeBoolean(req.body.isPublic, false);

    const asset = await CompanyAsset.create({
      title,
      description,
      category,
      assetType: 'link',
      linkUrl: req.body.linkUrl.trim(),
      isPublic,
      uploadedBy: req.userId,
    });

    logger.info(`Admin ${req.userId} added company asset link ${asset._id}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COMPANY_ASSET_UPLOADED,
      resourceType: 'companyAsset',
      resourceId: asset._id,
      metadata: { title: asset.title, category: asset.category, assetType: 'link' },
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Link added successfully', { asset });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/company-assets — full library for the admin portal, including
 * private (non-public) files. Searchable, filterable, paginated.
 */
export const listAssets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 24, maxLimit: 100 });
    const filter = {};

    if (req.query.category && COMPANY_ASSET_CATEGORIES.includes(req.query.category)) {
      filter.category = req.query.category;
    }
    if (req.query.isPublic !== undefined) {
      filter.isPublic = normalizeBoolean(req.query.isPublic);
    }
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { originalFileName: rx }];
    }

    const [assets, total] = await Promise.all([
      CompanyAsset.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('uploadedBy', 'firstName lastName email'),
      CompanyAsset.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Company assets fetched', {
      assets,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/company-assets/public — public, unauthenticated: visible files only. */
export const listPublicAssets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 24, maxLimit: 100 });
    const filter = { isPublic: true };

    if (req.query.category && COMPANY_ASSET_CATEGORIES.includes(req.query.category)) {
      filter.category = req.query.category;
    }

    const [assets, total] = await Promise.all([
      CompanyAsset.find(filter)
        .select(
          'title description category assetType fileUrl mimeType originalFileName fileSize linkUrl createdAt',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CompanyAsset.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Public company assets fetched', {
      assets,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/company-assets/:id/download — a short-lived signed S3 URL that
 * forces a real download (Content-Disposition: attachment). The object's
 * plain fileUrl is public-read but anonymous requests can't carry response
 * header overrides, so downloading has to go through a signed link.
 */
export const getDownloadUrl = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    }
    const asset = await CompanyAsset.findById(req.params.id);
    if (!asset) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    }
    if (asset.assetType === 'link') {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        "This entry is a link, not a stored file — there's nothing to download",
      );
    }

    const url = await getSignedDownloadUrl({
      key: asset.fileKey,
      filename: asset.originalFileName || asset.title,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Download link generated', { url });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/company-assets/:id — edit title/description/category or toggle public visibility. */
export const updateAsset = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    }
    const asset = await CompanyAsset.findById(req.params.id);
    if (!asset) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    }

    const writableFields =
      asset.assetType === 'link' ? [...WRITABLE_FIELDS, 'linkUrl'] : WRITABLE_FIELDS;
    const updates = pickDefined(req.body, writableFields);
    if (updates.title !== undefined && !String(updates.title).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Title cannot be empty');
    }
    if (updates.category !== undefined && !COMPANY_ASSET_CATEGORIES.includes(updates.category)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid category');
    }
    if (updates.linkUrl !== undefined) {
      if (!isHttpUrl(updates.linkUrl)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid http(s) URL is required');
      }
      updates.linkUrl = String(updates.linkUrl).trim();
    }

    const visibilityChanged =
      req.body.isPublic !== undefined && normalizeBoolean(req.body.isPublic) !== asset.isPublic;
    if (req.body.isPublic !== undefined) {
      updates.isPublic = normalizeBoolean(req.body.isPublic);
    }

    Object.assign(asset, updates);
    await asset.save();

    logger.info(`Admin ${req.userId} updated company asset ${asset._id}`);
    await recordAudit({
      req,
      action: visibilityChanged
        ? AUDIT_ACTIONS.COMPANY_ASSET_VISIBILITY_CHANGED
        : AUDIT_ACTIONS.COMPANY_ASSET_UPDATED,
      resourceType: 'companyAsset',
      resourceId: asset._id,
      metadata: visibilityChanged ? { isPublic: asset.isPublic } : { fields: Object.keys(updates) },
    });

    return sendResponse(res, HTTP_STATUS.OK, 'File updated', { asset });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/company-assets/:id — removes the S3 object and its library record. */
export const deleteAsset = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    }
    const asset = await CompanyAsset.findByIdAndDelete(req.params.id);
    if (!asset) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'File not found');
    }

    await deleteFromS3(asset.fileKey);

    logger.info(`Admin ${req.userId} deleted company asset ${req.params.id}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COMPANY_ASSET_DELETED,
      resourceType: 'companyAsset',
      resourceId: req.params.id,
      metadata: { title: asset.title },
    });

    return sendResponse(res, HTTP_STATUS.OK, 'File deleted', { success: true });
  } catch (error) {
    next(error);
  }
};
