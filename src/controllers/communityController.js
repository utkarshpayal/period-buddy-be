import CommunityPost from '../models/Community.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { broadcastToRoom } from '../config/websocket.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  normalizeBoolean,
  normalizeStringArray,
} from '../utils/apiHelpers.js';

const ANONYMOUS_USER = { firstName: 'Anonymous', lastName: '', profilePicture: null };

/**
 * Resolve author for a post or comment:
 * - If isAnonymous AND the requester is NOT the author → mask with ANONYMOUS_USER
 * - If isAnonymous AND the requester IS the author → return real user + isOwn flag
 * - If not anonymous → return real user as-is
 */
const resolveAuthor = (authorObj, authorId, requestingUserId) => {
  const isOwn = String(authorId) === String(requestingUserId);
  if (isOwn)
    return { ...((authorObj?.toObject ? authorObj.toObject() : authorObj) || {}), isOwn: true };
  return ANONYMOUS_USER;
};

/**
 * Shape a post's poll for the client: expose option vote counts + total, plus
 * the requester's own selections (myVote), and hide the raw per-user pollVotes.
 * Returns undefined when the post has no poll.
 */
const serializePoll = (object, requestingUserId) => {
  if (!object.poll || !Array.isArray(object.poll.options) || object.poll.options.length === 0) {
    return undefined;
  }
  const options = object.poll.options.map((option) => ({
    optionId: option.optionId,
    topic: option.topic,
    votes: option.votes || 0,
  }));
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  const myEntry = (object.pollVotes || []).find(
    (vote) => String(vote.userId) === String(requestingUserId),
  );
  return {
    question: object.poll.question,
    allowMultiple: !!object.poll.allowMultiple,
    options,
    totalVotes,
    myVote: myEntry ? myEntry.optionIds : [],
  };
};

const serializePost = (post, user, requestingUserId, { includeComments = true } = {}) => {
  const object = post.toObject ? post.toObject() : post;
  const likedBy = object.likedBy || [];
  const savedPosts = user?.savedCommunityPosts || [];
  // Prefer the denormalized commentCount (maintained on add/delete) so the feed
  // can drop the comments array entirely; fall back to the embedded length when
  // the full array is present (e.g. GET /:id).
  const totalCommentCount = object.commentCount ?? (object.comments || []).length;

  // Resolve post author
  const postAuthorId = object.userId?._id ?? object.userId;
  const isPostOwn = String(postAuthorId) === String(requestingUserId);
  let resolvedPostUser;
  if (object.isAnonymous) {
    // Anonymous post: mask for others, reveal (with isOwn) for the author
    resolvedPostUser = resolveAuthor(object.userId, postAuthorId, requestingUserId);
  } else {
    // Non-anonymous post: show real user, but still attach isOwn for the author
    const rawUser = object.userId?.toObject ? object.userId.toObject() : object.userId;
    resolvedPostUser = isPostOwn ? { ...(rawUser || {}), isOwn: true } : rawUser;
  }

  // Resolve each comment's author. Skipped entirely for the feed, where the
  // bodies aren't rendered — only the count is.
  const comments = !includeComments
    ? []
    : (object.comments || []).map((comment) => {
        const commentAuthorId = comment.userId?._id ?? comment.userId;
        const isCommentOwn = String(commentAuthorId) === String(requestingUserId);

        let resolvedCommentUser;
        if (comment.isAnonymous) {
          // Anonymous comment: mask for others, reveal (with isOwn) for the author
          resolvedCommentUser = isCommentOwn
            ? {
                ...((comment.userId?.toObject ? comment.userId.toObject() : comment.userId) || {}),
                isOwn: true,
              }
            : ANONYMOUS_USER;
        } else {
          // Non-anonymous comment: show real user, but still attach isOwn for the author
          const rawUser = comment.userId?.toObject ? comment.userId.toObject() : comment.userId;
          resolvedCommentUser = isCommentOwn ? { ...(rawUser || {}), isOwn: true } : rawUser;
        }

        return { ...comment, id: comment._id, userId: resolvedCommentUser };
      });

  return {
    ...object,
    id: object._id,
    userId: resolvedPostUser,
    comments,
    commentsCount: totalCommentCount,
    likedByMe: likedBy.some((id) => String(id) === String(user?._id)),
    savedByMe: savedPosts.some((id) => String(id) === String(object._id)),
    likedBy: undefined,
    poll: serializePoll(object, requestingUserId),
    pollVotes: undefined,
  };
};

/** GET /api/community?category=&page=1 — Paginated community posts */
export const getPosts = async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 15, maxLimit: 50 });

    const filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;
    if (search)
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { content: { $regex: escapeRegex(search), $options: 'i' } },
      ];

    const [posts, total, user] = await Promise.all([
      // Feed excludes comment bodies for payload/scale (a viral post could
      // embed thousands); only the count is shown here. Full comments load via
      // GET /:id when a user opens the comments sheet. `comments` is still
      // selected so the count is accurate, but its authors aren't populated.
      CommunityPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-comments')
        .populate('userId', 'firstName lastName profilePicture'),
      CommunityPost.countDocuments(filter),
      User.findById(req.userId).select('savedCommunityPosts reportedCommunityPosts'),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Posts fetched', {
      posts: posts.map((post) => serializePost(post, user, req.userId, { includeComments: false })),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/community — Create a post */
const ATTACHMENT_TYPES = ['image', 'video', 'audio'];

const normalizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((item) => item && typeof item.url === 'string' && item.url.trim())
    .map((item) => ({
      url: item.url.trim(),
      key: typeof item.key === 'string' ? item.key.trim() : undefined,
      type: ATTACHMENT_TYPES.includes(item.type) ? item.type : 'image',
    }));
};

const POLL_MIN_OPTIONS = 2;
const POLL_MAX_OPTIONS = 6;

/**
 * Validate and normalize a poll payload from createPost.
 * Accepts `{ question?, allowMultiple?, options: string[] }` and assigns stable
 * optionIds (option_1..option_n). Returns { poll } on success, { error } on a
 * validation failure, or {} when no poll was supplied.
 */
const normalizePoll = (poll) => {
  if (poll === undefined || poll === null) return {};

  const rawOptions = Array.isArray(poll.options) ? poll.options : [];
  const topics = rawOptions
    .map((option) => (typeof option === 'string' ? option : option?.topic))
    .map((topic) => (typeof topic === 'string' ? topic.trim() : ''))
    .filter(Boolean);

  if (topics.length < POLL_MIN_OPTIONS || topics.length > POLL_MAX_OPTIONS) {
    return { error: `A poll needs between ${POLL_MIN_OPTIONS} and ${POLL_MAX_OPTIONS} options` };
  }

  return {
    poll: {
      question: typeof poll.question === 'string' ? poll.question.trim() : undefined,
      allowMultiple: normalizeBoolean(poll.allowMultiple, false),
      options: topics.map((topic, index) => ({
        optionId: `option_${index + 1}`,
        topic,
        votes: 0,
      })),
    },
  };
};

export const createPost = async (req, res, next) => {
  try {
    const { title, content, category, tags, isAnonymous, attachments, poll } = req.body;

    if (!content?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Post content is required');
    }

    const { poll: normalizedPoll, error: pollError } = normalizePoll(poll);
    if (pollError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, pollError);
    }

    const created = await CommunityPost.create({
      userId: req.userId,
      title,
      content: content.trim(),
      category,
      tags: normalizeStringArray(tags),
      isAnonymous: normalizeBoolean(isAnonymous, true),
      attachments: normalizeAttachments(attachments),
      ...(normalizedPoll ? { poll: normalizedPoll } : {}),
    });

    logger.info('community_post_created', {
      action: 'community_post_created',
      userId: req.userId,
      postId: created._id,
      category,
      isAnonymous: created.isAnonymous,
    });

    // Populate userId so serializePost can set isOwn:true for the creator
    const [post, user] = await Promise.all([
      CommunityPost.findById(created._id)
        .populate('userId', 'firstName lastName profilePicture')
        .populate('comments.userId', 'firstName lastName profilePicture'),
      User.findById(req.userId).select('savedCommunityPosts reportedCommunityPosts'),
    ]);

    const serialized = serializePost(post, user, req.userId);

    try {
      broadcastToRoom('community', {
        type: 'community_notification',
        notificationType: 'post',
        senderId: req.userId,
        post: serialized,
      });
    } catch (wsErr) {
      logger.warn('ws_broadcast_failed', { error: wsErr.message });
    }

    return sendResponse(res, HTTP_STATUS.CREATED, 'Post created', serialized);
  } catch (error) {
    next(error);
  }
};

/** GET /api/community/:id — Get single post */
export const getPostById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    const [post, user] = await Promise.all([
      CommunityPost.findOne({ _id: req.params.id, isActive: true })
        .populate('userId', 'firstName lastName profilePicture')
        .populate('comments.userId', 'firstName lastName profilePicture'),
      User.findById(req.userId).select('savedCommunityPosts reportedCommunityPosts'),
    ]);
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Post', serializePost(post, user, req.userId));
  } catch (error) {
    next(error);
  }
};

/** POST /api/community/:id/like — Toggle like on a post */
export const toggleLike = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    const post = await CommunityPost.findOne({ _id: req.params.id, isActive: true });
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    const alreadyLiked = post.likedBy.some((id) => String(id) === String(req.userId));
    if (alreadyLiked) {
      post.likedBy.pull(req.userId);
      // `likes` is a virtual alias for `likeCount` (see Community.js) — only touch
      // the real field here, otherwise the virtual setter double-applies the delta.
      post.likeCount = Math.max(0, post.likeCount - 1);
    } else {
      post.likedBy.push(req.userId);
      post.likeCount += 1;
    }
    await post.save();

    if (!alreadyLiked && String(post.userId) !== String(req.userId)) {
      try {
        broadcastToRoom(`user_${post.userId}`, {
          type: 'community_notification',
          notificationType: 'like',
          senderId: req.userId,
          postId: post._id,
        });
      } catch (wsErr) {
        logger.warn('ws_broadcast_failed', { error: wsErr.message });
      }
    }

    return sendResponse(res, HTTP_STATUS.OK, alreadyLiked ? 'Unliked' : 'Liked', {
      likes: post.likes,
      likeCount: post.likeCount,
      likedByMe: !alreadyLiked,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/community/:id/comment — Add comment to post */
export const addComment = async (req, res, next) => {
  try {
    const { content, isAnonymous, attachments } = req.body;
    if (!content?.trim())
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Comment content required');
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    const [post, author] = await Promise.all([
      CommunityPost.findOne({ _id: req.params.id, isActive: true }),
      User.findById(req.userId).select('firstName lastName profilePicture'),
    ]);
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    const anonymous = normalizeBoolean(isAnonymous, true);

    post.comments.push({
      userId: req.userId,
      content: content.trim(),
      isAnonymous: anonymous,
      attachments: normalizeAttachments(attachments),
    });
    post.commentCount = post.comments.length;
    await post.save();

    const rawComment = post.comments[post.comments.length - 1];
    const comment =
      rawComment && typeof rawComment.toObject === 'function' ? rawComment.toObject() : rawComment;

    // Always return the real author info to the commenter (isOwn: true),
    // even when the comment is anonymous — other users will see "Anonymous".
    const resolvedUser = anonymous
      ? { ...(author?.toObject ? author.toObject() : author), isOwn: true }
      : author?.toObject
        ? author.toObject()
        : author;

    logger.info('community_comment_added', {
      action: 'community_comment_added',
      userId: req.userId,
      postId: post._id,
      commentId: comment._id,
    });

    try {
      broadcastToRoom('community', {
        type: 'community_notification',
        notificationType: 'comment',
        senderId: req.userId,
        postId: post._id,
        comment: {
          ...comment,
          userId: author?.toObject ? author.toObject() : author,
        },
      });
    } catch (wsErr) {
      logger.warn('ws_broadcast_failed', { error: wsErr.message });
    }

    if (String(post.userId) !== String(req.userId)) {
      try {
        broadcastToRoom(`user_${post.userId}`, {
          type: 'community_notification',
          notificationType: 'comment',
          senderId: req.userId,
          postId: post._id,
          commentId: comment._id,
        });
      } catch (wsErr) {
        logger.warn('ws_broadcast_failed', { error: wsErr.message });
      }
    }

    return sendResponse(res, HTTP_STATUS.CREATED, 'Comment added', {
      comment: { ...comment, id: comment._id, userId: resolvedUser },
      commentsCount: post.comments.length,
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/community/:id — Soft-delete own post */
export const deletePost = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    const post = await CommunityPost.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { isActive: false },
      { new: true },
    );
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found or not yours');
    return sendResponse(res, HTTP_STATUS.OK, 'Post deleted');
  } catch (error) {
    next(error);
  }
};

/** POST /api/community/:id/save — Toggle save on a post */
export const toggleSave = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    const post = await CommunityPost.findOne({ _id: req.params.id, isActive: true });
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    const user = await User.findById(req.userId).select('savedCommunityPosts walletBalance');
    const alreadySaved = user.savedCommunityPosts.some((id) => String(id) === String(post._id));

    if (alreadySaved) {
      user.savedCommunityPosts = user.savedCommunityPosts.filter(
        (id) => String(id) !== String(post._id),
      );
    } else {
      user.savedCommunityPosts.push(post._id);
      user.walletBalance = (user.walletBalance || 0) + 3;
    }
    await user.save();

    return sendResponse(res, HTTP_STATUS.OK, alreadySaved ? 'Post unsaved' : 'Post saved', {
      savedByMe: !alreadySaved,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/community/:id/report — Report a post */
export const reportPost = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    const { reason } = req.body;
    const post = await CommunityPost.findOne({ _id: req.params.id, isActive: true });
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    const user = await User.findById(req.userId).select('reportedCommunityPosts');
    const alreadyReported = user.reportedCommunityPosts.some(
      (report) => String(report.postId) === String(post._id),
    );

    if (!alreadyReported) {
      user.reportedCommunityPosts.push({
        postId: post._id,
        reason: reason?.trim() || 'No reason provided',
      });
      await user.save();
      post.reportCount = (post.reportCount || 0) + 1;
      await post.save();
    }

    logger.info('community_post_reported', {
      action: 'community_post_reported',
      userId: req.userId,
      postId: post._id,
      alreadyReported,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Post reported', {
      reported: true,
      alreadyReported,
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/community/:id/comment/:commentId — Delete own comment */
export const deleteComment = async (req, res, next) => {
  try {
    const { id, commentId } = req.params;

    if (!isValidObjectId(id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }
    if (!isValidObjectId(commentId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid comment id');
    }

    const post = await CommunityPost.findOne({ _id: id, isActive: true });
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');

    const comment = post.comments.id(commentId);
    if (!comment) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Comment not found');

    const commentAuthorId = comment.userId?._id ?? comment.userId;
    if (String(commentAuthorId) !== String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You can only delete your own comments');
    }

    post.comments.pull({ _id: commentId });
    post.commentCount = post.comments.length;
    await post.save();

    logger.info('community_comment_deleted', {
      action: 'community_comment_deleted',
      userId: req.userId,
      postId: id,
      commentId,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Comment deleted', {
      commentsCount: post.comments.length,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/community/:id/poll/vote — Cast a vote on a post's poll */
export const votePoll = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid post id');
    }

    // Accept either optionIds (multi-select) or a single optionId for convenience.
    const rawOptionIds = Array.isArray(req.body.optionIds)
      ? req.body.optionIds
      : req.body.optionId
        ? [req.body.optionId]
        : [];
    const optionIds = [...new Set(rawOptionIds.map((id) => String(id).trim()).filter(Boolean))];
    if (optionIds.length === 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'At least one optionId is required');
    }

    const post = await CommunityPost.findOne({ _id: req.params.id, isActive: true });
    if (!post) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Post not found');
    if (!post.poll || !Array.isArray(post.poll.options) || post.poll.options.length === 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This post has no poll');
    }

    if (!post.poll.allowMultiple && optionIds.length > 1) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This poll only allows a single choice');
    }

    if (post.pollVotes.some((vote) => String(vote.userId) === String(req.userId))) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'You have already voted on this poll');
    }

    const validIds = new Set(post.poll.options.map((option) => option.optionId));
    if (optionIds.some((id) => !validIds.has(id))) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid poll option');
    }

    post.poll.options.forEach((option) => {
      if (optionIds.includes(option.optionId)) option.votes += 1;
    });
    post.pollVotes.push({ userId: req.userId, optionIds });
    await post.save();
    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 5 } });

    const totalVotes = post.poll.options.reduce((sum, option) => sum + option.votes, 0);
    return sendResponse(res, HTTP_STATUS.OK, 'Vote counted', {
      poll: {
        question: post.poll.question,
        allowMultiple: !!post.poll.allowMultiple,
        options: post.poll.options.map((option) => ({
          optionId: option.optionId,
          topic: option.topic,
          votes: option.votes,
        })),
        totalVotes,
        myVote: optionIds,
      },
      tokensAwarded: 5,
    });
  } catch (error) {
    next(error);
  }
};
