import CompanyFolder from '../models/CompanyFolder.js';
import CompanyAsset from '../models/CompanyAsset.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { deleteFromS3 } from '../utils/s3.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import logger from '../utils/logger.js';

/** Root-to-here breadcrumb for a folder, e.g. [{_id,name:"Investors"}, {_id,name:"2024"}]. */
async function buildFolderPath(folderId) {
  const path = [];
  let current = await CompanyFolder.findById(folderId).select('name parentId');
  while (current) {
    path.unshift({ _id: current._id, name: current.name });
    if (!current.parentId) break;
    current = await CompanyFolder.findById(current.parentId).select('name parentId');
  }
  return path;
}

/** true if `candidateAncestorId` is `folderId` itself or one of its ancestors. */
async function isSelfOrAncestor(folderId, candidateAncestorId) {
  let cursor = await CompanyFolder.findById(candidateAncestorId).select('_id parentId');
  while (cursor) {
    if (String(cursor._id) === String(folderId)) return true;
    if (!cursor.parentId) return false;
    cursor = await CompanyFolder.findById(cursor.parentId).select('_id parentId');
  }
  return false;
}

/**
 * GET /api/company-folders?parentId= — subfolders of a folder (root when
 * parentId is omitted), each with a direct-child item count, plus the
 * breadcrumb path down to that folder for the admin UI.
 */
export const listFolders = async (req, res, next) => {
  try {
    let parentId = null;
    if (req.query.parentId) {
      if (!isValidObjectId(req.query.parentId)) {
        return sendError(res, HTTP_STATUS.NOT_FOUND, 'Folder not found');
      }
      const parent = await CompanyFolder.findById(req.query.parentId);
      if (!parent) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Folder not found');
      parentId = parent._id;
    }

    const folders = await CompanyFolder.find({ parentId }).sort({ name: 1 });
    const folderIds = folders.map((f) => f._id);

    const [subfolderCounts, assetCounts] = await Promise.all([
      CompanyFolder.aggregate([
        { $match: { parentId: { $in: folderIds } } },
        { $group: { _id: '$parentId', count: { $sum: 1 } } },
      ]),
      CompanyAsset.aggregate([
        { $match: { folderId: { $in: folderIds } } },
        { $group: { _id: '$folderId', count: { $sum: 1 } } },
      ]),
    ]);
    const subfolderCountMap = new Map(subfolderCounts.map((c) => [String(c._id), c.count]));
    const assetCountMap = new Map(assetCounts.map((c) => [String(c._id), c.count]));

    const withCounts = folders.map((f) => ({
      ...f.toObject(),
      subfolderCount: subfolderCountMap.get(String(f._id)) || 0,
      assetCount: assetCountMap.get(String(f._id)) || 0,
    }));

    const path = parentId ? await buildFolderPath(parentId) : [];

    return sendResponse(res, HTTP_STATUS.OK, 'Folders fetched', { folders: withCounts, path });
  } catch (error) {
    next(error);
  }
};

/** POST /api/company-folders — create a folder (admin only). */
export const createFolder = async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim().slice(0, 100);
    if (!name) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A folder name is required');
    }

    let parentId = null;
    if (req.body.parentId) {
      if (!isValidObjectId(req.body.parentId)) {
        return sendError(res, HTTP_STATUS.NOT_FOUND, 'Parent folder not found');
      }
      const parent = await CompanyFolder.findById(req.body.parentId);
      if (!parent) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Parent folder not found');
      parentId = parent._id;
    }

    const folder = await CompanyFolder.create({ name, parentId, createdBy: req.userId });

    logger.info(`Admin ${req.userId} created company folder ${folder._id}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COMPANY_FOLDER_CREATED,
      resourceType: 'companyFolder',
      resourceId: folder._id,
      metadata: { name: folder.name, parentId: folder.parentId },
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Folder created', { folder });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/company-folders/:id — rename and/or move a folder (admin only). */
export const updateFolder = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Folder not found');
    }
    const folder = await CompanyFolder.findById(req.params.id);
    if (!folder) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Folder not found');

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 100);
      if (!name) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Folder name cannot be empty');
      folder.name = name;
    }

    if (req.body.parentId !== undefined) {
      const targetParentId = req.body.parentId || null;
      if (targetParentId) {
        if (!isValidObjectId(targetParentId)) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid destination folder');
        }
        const targetParent = await CompanyFolder.findById(targetParentId);
        if (!targetParent)
          return sendError(res, HTTP_STATUS.NOT_FOUND, 'Destination folder not found');
        if (await isSelfOrAncestor(folder._id, targetParentId)) {
          return sendError(
            res,
            HTTP_STATUS.BAD_REQUEST,
            "Can't move a folder into itself or one of its own subfolders",
          );
        }
      }
      folder.parentId = targetParentId;
    }

    await folder.save();

    logger.info(`Admin ${req.userId} updated company folder ${folder._id}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COMPANY_FOLDER_UPDATED,
      resourceType: 'companyFolder',
      resourceId: folder._id,
      metadata: { name: folder.name, parentId: folder.parentId },
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Folder updated', { folder });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/company-folders/:id — deletes the folder, every subfolder
 * beneath it, and every file/link inside any of them (S3 objects included).
 * No trash/undo — the frontend confirms with item counts before calling this.
 */
export const deleteFolder = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Folder not found');
    }
    const folder = await CompanyFolder.findById(req.params.id);
    if (!folder) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Folder not found');

    // Breadth-first collect this folder + every descendant folder id.
    const allFolderIds = [folder._id];
    let frontier = [folder._id];
    while (frontier.length) {
      const children = await CompanyFolder.find({ parentId: { $in: frontier } }).select('_id');
      const childIds = children.map((c) => c._id);
      allFolderIds.push(...childIds);
      frontier = childIds;
    }

    const assets = await CompanyAsset.find({ folderId: { $in: allFolderIds } });
    await Promise.all(
      assets.filter((a) => a.assetType === 'file').map((a) => deleteFromS3(a.fileKey)),
    );

    await CompanyAsset.deleteMany({ _id: { $in: assets.map((a) => a._id) } });
    await CompanyFolder.deleteMany({ _id: { $in: allFolderIds } });

    logger.info(
      `Admin ${req.userId} deleted company folder ${req.params.id} ` +
        `(${allFolderIds.length} folder(s), ${assets.length} item(s))`,
    );
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COMPANY_FOLDER_DELETED,
      resourceType: 'companyFolder',
      resourceId: req.params.id,
      metadata: {
        name: folder.name,
        deletedFolders: allFolderIds.length,
        deletedAssets: assets.length,
      },
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Folder deleted', {
      success: true,
      deletedFolders: allFolderIds.length,
      deletedAssets: assets.length,
    });
  } catch (error) {
    next(error);
  }
};
