import path from 'path';
import express from 'express';
import multer from 'multer';
import * as contentController from '../controllers/contentController.js';
import { uploadContentMedia } from '../controllers/uploadController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { withApproval } from '../middleware/approvalGate.js';
import { PERMISSIONS, DEPARTMENTS, hasPermission } from '../config/permissions.js';

const router = express.Router();

router.use(authenticate, requirePermission(PERMISSIONS.CONTENT_READ));

const canWrite = requirePermission(PERMISSIONS.CONTENT_WRITE);

const contentTitle = (req, before) =>
  before?.title || before?.question || req.body?.title || req.body?.question || 'item';

// Content Admins (content.write without content.publish) may create items,
// but only as drafts — publishing is a separate, approval-gated step.
const draftOnlyUnlessPublisher = (req, res, next) => {
  if (!hasPermission(req.user.role, PERMISSIONS.CONTENT_PUBLISH)) {
    req.body = contentController.forceDraftVisibility(req.body);
  }
  next();
};

// A request for an item that doesn't exist goes straight to the controller
// so the caller gets a 404 now, not a doomed approval request.
const itemExists = async (req) => Boolean(await contentController.loadContentForRequest(req));

const contentGate = {
  directPermission: PERMISSIONS.CONTENT_PUBLISH,
  needsApproval: itemExists,
  department: DEPARTMENTS.CONTENT,
  resourceType: (req) => req.params.type,
  snapshot: contentController.snapshotContent,
};

// Browsers on some OSes (notably Linux, when the system mime database is
// missing an entry) send an empty or generic `application/octet-stream`
// mimetype for otherwise-normal video/audio/image files. Fall back to the
// file extension in that case so a real .mp4/.mp3/.jpg etc. isn't rejected.
const MIME_TYPE_BY_EXTENSION = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

// Reel video / guide audio / thumbnail image uploads. Kept admin-only
// (unlike the generic POST /api/upload, which only requires `authenticate`
// for things like profile pictures) since these files feed straight into
// content records.
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB — enough for a trimmed reel clip
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('image/')
    ) {
      return cb(null, true);
    }

    const fallbackMimeType = MIME_TYPE_BY_EXTENSION[path.extname(file.originalname).toLowerCase()];
    if (fallbackMimeType) {
      // Mutate in place — `file` is the same object multer attaches to
      // req.file, so this fallback also becomes the S3 object's Content-Type.
      file.mimetype = fallbackMimeType;
      return cb(null, true);
    }

    return cb(new Error('Only video, audio, or image uploads are supported'));
  },
});

router.get('/', contentController.listContent);
router.get('/types', contentController.getContentTypes);
router.get('/summary', contentController.getContentSummary);
/**
 * @route   POST /api/content/media/upload
 * @desc    Upload a reel video, guide audio, or thumbnail/cover image file
 *          to the `thenura` S3 bucket under `content/<userId>/<folder>`
 *          (folder = 'reels', 'audio', or 'thumbnails' in the request body).
 *          Returns { url, key } for the caller to store as
 *          directMp4Url/audioUrl/imageUrl.
 * @access  Private (admin)
 */
router.post('/media/upload', canWrite, mediaUpload.single('file'), uploadContentMedia);
router.post('/:type', canWrite, draftOnlyUnlessPublisher, contentController.createContent);
router.get('/:type/:id', contentController.getContentById);

// Editing a draft applies immediately; editing something live (or an edit
// that would make it live) is held for a Content Super Admin.
router.put(
  '/:type/:id',
  canWrite,
  withApproval(
    {
      ...contentGate,
      key: 'content.update',
      action: 'update',
      needsApproval: async (req) => {
        const loaded = await contentController.loadContentForRequest(req);
        if (!loaded) return false; // let the controller 404
        return (
          contentController.isContentLive(loaded) || contentController.bodyRequestsLive(req.body)
        );
      },
      summarize: (req, before) => `Edit "${contentTitle(req, before)}"`,
    },
    contentController.updateContent,
  ),
);

router.patch(
  '/:type/:id/publish',
  canWrite,
  withApproval(
    {
      ...contentGate,
      key: 'content.visibility',
      action: 'publish',
      summarize: (req, before) =>
        `${contentController.bodyRequestsLive(req.body) ? 'Publish' : 'Unpublish'} "${contentTitle(req, before)}"`,
    },
    contentController.setContentVisibility,
  ),
);

router.delete(
  '/:type/:id',
  canWrite,
  withApproval(
    {
      ...contentGate,
      key: 'content.delete',
      action: 'delete',
      summarize: (req, before) => `Remove "${contentTitle(req, before)}"`,
    },
    contentController.deleteContent,
  ),
);

export default router;
