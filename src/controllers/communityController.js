import CommunityPost from '../models/Community.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
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
  if (isOwn) return { ...((authorObj?.toObject ? authorObj.toObject() : authorObj) || {}), isOwn: true };
  return ANONYMOUS_USER;
};

const serializePost = (post, user, requestingUserId) => {
  const object = post.toObject ? post.toObject() : post;
  const likedBy = object.likedBy || [];
  const savedPosts = user?.savedCommunityPosts || [];

  // Resolve post author
  const postAuthorId = object.userId?._id ?? object.userId;
  const resolvedPostUser = object.isAnonymous
    ? resolveAuthor(object.userId, postAuthorId, requestingUserId)
    : (object.userId?.toObject ? object.userId.toObject() : object.userId);

  // Resolve each comment's author
  const comments = (object.comments || []).map((comment) => {
    const commentAuthorId = comment.userId?._id ?? comment.userId;
    const isCommentOwn = String(commentAuthorId) === String(requestingUserId);

    let resolvedCommentUser;
    if (comment.isAnonymous) {
      // Anonymous comment: mask for others, reveal (with isOwn) for the author
      resolvedCommentUser = isCommentOwn
        ? { ...((comment.userId?.toObject ? comment.userId.toObject() : comment.userId) || {}), isOwn: true }
        : ANONYMOUS_USER;
    } else {
      // Non-anonymous comment: show real user, but still attach isOwn for the author
      const rawUser = comment.userId?.toObject ? comment.userId.toObject() : comment.userId;
      resolvedCommentUser = isCommentOwn ? { ...(rawUser || {}), isOwn: true } : rawUser;
    }

    return { ...comment, userId: resolvedCommentUser };
  });

  return {
    ...object,
    id: object._id,
    userId: resolvedPostUser,
    comments,
    commentsCount: comments.length,
    likedByMe: likedBy.some((id) => String(id) === String(user?._id)),
    savedByMe: savedPosts.some((id) => String(id) === String(object._id)),
    likedBy: undefined,
  };
};

/** GET /api/community?category=&page=1 — Paginated community posts */
export const getPosts = async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 15, maxLimit: 50 });

    const filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;
    if (search) filter.$or = [
      { title: { $regex: escapeRegex(search), $options: 'i' } },
      { content: { $regex: escapeRegex(search), $options: 'i' } },
    ];

    const [posts, total, user] = await Promise.all([
      CommunityPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('userId', 'firstName lastName profilePicture')
        .populate('comments.userId', 'firstName lastName profilePicture'),
      CommunityPost.countDocuments(filter),
      User.findById(req.userId).select('savedCommunityPosts reportedCommunityPosts'),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Posts fetched', {
      posts: posts.map((post) => serializePost(post, user, req.userId)),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/community — Create a post */
export const createPost = async (req, res, next) => {
  try {
    const { title, content, category, tags, isAnonymous } = req.body;

    if (!content?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Post content is required');
    }

    const created = await CommunityPost.create({
      userId: req.userId,
      title,
      content: content.trim(),
      category,
      tags: normalizeStringArray(tags),
      isAnonymous: normalizeBoolean(isAnonymous, true),
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

    return sendResponse(res, HTTP_STATUS.CREATED, 'Post created', serializePost(post, user, req.userId));
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
      post.likes = Math.max(0, post.likes - 1);
    } else {
      post.likedBy.push(req.userId);
      post.likes += 1;
    }
    await post.save();

    return sendResponse(res, HTTP_STATUS.OK, alreadyLiked ? 'Unliked' : 'Liked', {
      likes: post.likes,
      likedByMe: !alreadyLiked,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/community/:id/comment — Add comment to post */
export const addComment = async (req, res, next) => {
  try {
    const { content, isAnonymous } = req.body;
    if (!content?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Comment content required');
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
    });
    await post.save();

    const comment = post.comments[post.comments.length - 1].toObject();

    // Always return the real author info to the commenter (isOwn: true),
    // even when the comment is anonymous — other users will see "Anonymous".
    const resolvedUser = anonymous
      ? { ...(author?.toObject ? author.toObject() : author), isOwn: true }
      : (author?.toObject ? author.toObject() : author);

    logger.info('community_comment_added', {
      action: 'community_comment_added',
      userId: req.userId,
      postId: post._id,
      commentId: comment._id,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Comment added', {
      comment: { ...comment, userId: resolvedUser },
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
      { new: true }
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

    const user = await User.findById(req.userId).select('savedCommunityPosts tokenEarned');
    const alreadySaved = user.savedCommunityPosts.some((id) => String(id) === String(post._id));

    if (alreadySaved) {
      user.savedCommunityPosts = user.savedCommunityPosts.filter((id) => String(id) !== String(post._id));
    } else {
      user.savedCommunityPosts.push(post._id);
      user.tokenEarned = (user.tokenEarned || 0) + 3;
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
    const alreadyReported = user.reportedCommunityPosts.some((report) => String(report.postId) === String(post._id));

    if (!alreadyReported) {
      user.reportedCommunityPosts.push({
        postId: post._id,
        reason: reason?.trim() || 'No reason provided',
      });
      await user.save();
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

    if (String(comment.userId) !== String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You can only delete your own comments');
    }

    post.comments.pull({ _id: commentId });
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

