import CommunityPost from '../models/Community.js';
import Doctor from '../models/Doctor.js';
import Notification from '../models/Notification.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { broadcastToRoom } from '../config/websocket.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
} from '../utils/apiHelpers.js';
import {
  countExpertAnswers,
  expertSnapshot,
  isExpertComment,
  publicExpert,
} from '../utils/communityExpert.js';
import { serializeExpertComment } from './communityController.js';

/*
 * Community answers from the Clinician portal (/api/doctor/community).
 * Gynecologists read the community feed and answer posts; an answer is a
 * normal post comment with an `expert` block, which the app shows as
 * "Medically verified", with the doctor's name only if they chose to show it.
 * Doctors never see who wrote a post or a comment: every member is anonymous
 * here, whatever the post's own setting.
 */

const ANSWER_MAX = 2000;
const VIEWS = ['unanswered', 'mine', 'all'];

const findDoctor = (userId) =>
  Doctor.findOne({ userId, deletedAt: null }).select('name specialty avatarUrl');

const postRoute = (postId) => `/community?postId=${postId}`;

const answeredBy = (comments, doctorId) =>
  (comments || []).some(
    (c) => isExpertComment(c) && String(c.expert.doctorId) === String(doctorId),
  );

const serializePoll = (poll) =>
  poll?.options?.length
    ? {
        question: poll.question,
        options: poll.options.map((o) => ({ topic: o.topic, votes: o.votes || 0 })),
      }
    : undefined;

/** A post as the portal sees it: no author, and comments only on the detail view. */
const serializeForDoctor = (post, doctorId, { withComments = false } = {}) => {
  const object = post.toObject ? post.toObject() : post;
  const out = {
    id: String(object._id),
    title: object.title || '',
    content: object.content,
    category: object.category,
    tags: object.tags || [],
    attachments: object.attachments || [],
    poll: serializePoll(object.poll),
    likeCount: object.likeCount || 0,
    commentCount: object.commentCount ?? (object.comments || []).length,
    expertAnswerCount: object.expertAnswerCount || 0,
    answeredByMe: answeredBy(object.comments, doctorId),
    createdAt: object.createdAt,
  };
  if (!withComments) return out;
  out.comments = (object.comments || []).map((comment) => {
    const base = {
      id: String(comment._id),
      content: comment.content,
      attachments: comment.attachments || [],
      createdAt: comment.createdAt,
    };
    if (!isExpertComment(comment))
      return { ...base, author: 'Community member', expert: null, isMine: false };
    const isMine = String(comment.expert.doctorId) === String(doctorId);
    const shown = publicExpert(comment.expert);
    return {
      ...base,
      author: shown.name ?? 'Verified gynaecologist',
      // Your own answer also shows your name, so you can see what you chose.
      expert: isMine ? { ...shown, name: comment.expert.name } : shown,
      isMine,
    };
  });
  return out;
};

/** GET /api/doctor/community?view=unanswered|mine|all&category=&search=&page=&limit= */
export const listPosts = async (req, res, next) => {
  try {
    const doctor = await findDoctor(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const view = VIEWS.includes(req.query.view) ? req.query.view : 'unanswered';
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 50 });

    const filter = { isActive: true, status: { $ne: 'removed' } };
    if (view === 'unanswered') filter.expertAnswerCount = { $not: { $gt: 0 } };
    if (view === 'mine') filter['comments.expert.doctorId'] = doctor._id;
    const { category, search } = req.query;
    if (typeof category === 'string' && category && category !== 'all') filter.category = category;
    if (typeof search === 'string' && search.trim()) {
      const pattern = { $regex: escapeRegex(search.trim()), $options: 'i' };
      filter.$or = [{ title: pattern }, { content: pattern }, { tags: pattern }];
    }

    const [posts, total] = await Promise.all([
      CommunityPost.find(filter)
        // Unanswered: oldest first, so nobody waits forever. The rest: newest first.
        .sort({ createdAt: view === 'unanswered' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'title content category tags attachments poll likeCount commentCount expertAnswerCount createdAt comments.expert.doctorId',
        )
        .lean(),
      CommunityPost.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Community posts', {
      view,
      posts: posts.map((post) => serializeForDoctor(post, doctor._id)),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/doctor/community/:id — one post with its comments */
export const getPost = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    const doctor = await findDoctor(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const post = await CommunityPost.findOne({ _id: req.params.id, isActive: true })
      .select('-likedBy -pollVotes')
      .lean();
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Community post',
      serializeForDoctor(post, doctor._id, { withComments: true }),
    );
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/community/:id/answers — { content, showName } */
export const answerPost = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Write your answer first');
    if (content.length > ANSWER_MAX) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `An answer can be at most ${ANSWER_MAX} characters`,
      );
    }
    const showName = req.body?.showName === true;

    const doctor = await findDoctor(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const post = await CommunityPost.findOne({ _id: req.params.id, isActive: true });
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    post.comments.push({
      userId: req.userId,
      content,
      isAnonymous: false,
      expert: expertSnapshot(doctor, showName),
    });
    post.commentCount = post.comments.length;
    post.expertAnswerCount = countExpertAnswers(post.comments);
    await post.save();

    const saved = post.comments[post.comments.length - 1].toObject();
    const shown = publicExpert(saved.expert);

    logger.info('community_expert_answer_added', {
      action: 'community_expert_answer_added',
      doctorId: String(doctor._id),
      postId: String(post._id),
      commentId: String(saved._id),
      showName,
    });

    // Live update for anyone with the feed open, same event as a member's comment.
    try {
      broadcastToRoom('community', {
        type: 'community_notification',
        notificationType: 'comment',
        senderId: req.userId,
        postId: post._id,
        comment: serializeExpertComment(saved, null),
      });
      broadcastToRoom(`user_${post.userId}`, {
        type: 'community_notification',
        notificationType: 'comment',
        senderId: req.userId,
        postId: post._id,
        commentId: saved._id,
      });
    } catch (wsErr) {
      logger.warn('ws_broadcast_failed', { error: wsErr.message });
    }

    if (String(post.userId) !== String(req.userId)) {
      Notification.create({
        userId: post.userId,
        type: 'community_reply',
        title: 'A gynaecologist answered your post',
        body: `${shown.name ?? 'A verified gynaecologist'} replied. Tap to read the answer.`,
        data: { kind: 'expert_answer', postId: String(post._id), route: postRoute(post._id) },
      }).catch((error) =>
        logger.error('community_expert_notify_failed', {
          action: 'community_expert_notify_failed',
          postId: String(post._id),
          error: error.message,
        }),
      );
    }

    return sendResponse(res, HTTP_STATUS.CREATED, 'Answer posted', {
      post: serializeForDoctor(post, doctor._id, { withComments: true }),
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/community/:id/answers/:commentId — remove your own answer */
export const deleteAnswer = async (req, res, next) => {
  try {
    const { id, commentId } = req.params;
    if (!isValidObjectId(id) || !isValidObjectId(commentId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    }
    const doctor = await findDoctor(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const post = await CommunityPost.findById(id);
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');
    const comment = post.comments.id(commentId);
    if (
      !comment ||
      !isExpertComment(comment) ||
      String(comment.expert.doctorId) !== String(doctor._id)
    ) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Answer not found');
    }

    post.comments.pull({ _id: commentId });
    post.commentCount = post.comments.length;
    post.expertAnswerCount = countExpertAnswers(post.comments);
    await post.save();

    logger.info('community_expert_answer_deleted', {
      action: 'community_expert_answer_deleted',
      doctorId: String(doctor._id),
      postId: id,
      commentId,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Answer deleted', {
      post: serializeForDoctor(post, doctor._id, { withComments: true }),
    });
  } catch (error) {
    next(error);
  }
};
