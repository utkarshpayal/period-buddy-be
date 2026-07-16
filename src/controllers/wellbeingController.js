import WellbeingResource from '../models/WellbeingResource.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { HEX_COLOR_REGEX, isValidObjectId, normalizeStringArray, pickDefined } from '../utils/apiHelpers.js';

const wellbeingDecks = {
  spark: [
    'What is one small, non-physical gesture that makes you feel loved or secure?',
    'What couple habit would feel supportive during your next cycle?',
    'What boundary do you want to discuss around intimacy during heavy flow days?',
    'What helps you feel emotionally safe when your body is uncomfortable?',
  ],
  positions: [
    {
      name: 'Mission Comfort',
      focus: 'Comfort, closeness, and lower pressure',
      tip: 'Use a soft pillow under the hips if it reduces pelvic pressure. Pause or change position if anything feels uncomfortable.',
    },
    {
      name: 'Lotus Variant',
      focus: 'Closeness and easy pacing',
      tip: 'A relaxed seated posture can make pacing easier and lets either partner slow down whenever needed.',
    },
    {
      name: 'Side Spoon Wrap',
      focus: 'Low pressure and low effort',
      tip: 'Side-lying can feel easier on crampy or tired days because it reduces pressure and body weight.',
    },
  ],
};

/** GET /api/wellbeing?type=sexual_wellbeing|hygiene — List resources */
export const getResources = async (req, res, next) => {
  try {
    const { type } = req.query;
    const filter = { isActive: true };
    if (type) filter.type = type;

    const resources = await WellbeingResource.find(filter).sort({ order: 1 });

    logger.info('wellbeing_resources_fetched', { action: 'wellbeing_resources_fetched', type, count: resources.length });

    return sendResponse(res, HTTP_STATUS.OK, 'Resources fetched', resources);
  } catch (error) {
    next(error);
  }
};

/** GET /api/wellbeing/:id — Single resource detail */
export const getResourceById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid resource id');
    }

    const resource = await WellbeingResource.findOne({ _id: req.params.id, isActive: true });
    if (!resource) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Resource', resource);
  } catch (error) {
    next(error);
  }
};

/** POST /api/wellbeing — Admin: Create resource */
export const createResource = async (req, res, next) => {
  try {
    const { type, title, icon, color, summary, extendedGuide, items, order, estimatedReadTime, videoUrl, audioUrl } = req.body;

    if (!type || !title || !summary) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'type, title, and summary are required');
    }
    if (color && !HEX_COLOR_REGEX.test(color)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'color must be a valid hex color');
    }

    const resource = await WellbeingResource.create({
      type,
      title: title.trim(),
      icon,
      color,
      summary: summary.trim(),
      extendedGuide: normalizeStringArray(extendedGuide),
      items,
      order,
      estimatedReadTime: estimatedReadTime !== undefined ? Number(estimatedReadTime) : undefined,
      videoUrl: videoUrl?.trim(),
      audioUrl: audioUrl?.trim(),
    });

    logger.info('wellbeing_resource_created', { action: 'wellbeing_resource_created', id: resource._id, type, title });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Resource created', resource);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/wellbeing/:id — Admin: Update resource */
export const updateResource = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid resource id');
    }
    if (req.body.color && !HEX_COLOR_REGEX.test(req.body.color)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'color must be a valid hex color');
    }

    const updates = pickDefined(req.body, [
      'type', 'title', 'icon', 'color', 'summary', 'extendedGuide', 'items', 'order', 'isActive',
      'estimatedReadTime', 'videoUrl', 'audioUrl'
    ]);
    if (updates.extendedGuide !== undefined) updates.extendedGuide = normalizeStringArray(updates.extendedGuide);

    const resource = await WellbeingResource.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!resource) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Resource updated', resource);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/wellbeing/:id — Admin: Soft delete resource */
export const deleteResource = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid resource id');
    }

    const resource = await WellbeingResource.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!resource) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Resource not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Resource deleted');
  } catch (error) {
    next(error);
  }
};

/** GET /api/wellbeing/games — Intimacy game decks */
export const getGameDecks = async (req, res, next) => {
  try {
    const { deck } = req.query;
    if (deck && !wellbeingDecks[deck]) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid deck');
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Wellbeing game decks fetched', deck ? {
      deck,
      cards: wellbeingDecks[deck],
    } : wellbeingDecks);
  } catch (error) {
    next(error);
  }
};

/** POST /api/wellbeing/games/:deck/draw — Draw a card and earn tokens */
export const drawGameCard = async (req, res, next) => {
  try {
    const { deck } = req.params;
    const cards = wellbeingDecks[deck];
    if (!cards) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid deck');
    }

    const fallbackIndex = String(req.userId)
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), new Date().getUTCDate()) % cards.length;
    const index = Number.isInteger(Number(req.body.index))
      ? Number(req.body.index) % cards.length
      : fallbackIndex;
    const normalizedIndex = index < 0 ? 0 : index;
    const reward = deck === 'positions' ? 2 : 1;

    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: reward } });

    return sendResponse(res, HTTP_STATUS.OK, 'Game card drawn', {
      deck,
      index: normalizedIndex,
      card: cards[normalizedIndex],
      tokensAwarded: reward,
    });
  } catch (error) {
    next(error);
  }
};
