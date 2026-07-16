import User from '../models/User.js';
import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import Habit from '../models/Habit.js';
import { comparePassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { pickDefined, todayDateKey } from '../utils/apiHelpers.js';
import { computeCyclePredictions, calculateTrackingStreak } from '../utils/cycle.js';
import { userRoleEnum } from '../enums/enums.js';
/**
 * User Signup Controller
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const signup = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone, dateOfBirth, gender } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {

      return sendError(res, HTTP_STATUS.CONFLICT, ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
    }

    // Create new user
    const user = new User({
      firstName,
      lastName,
      email,
      password,
      phone,
      dateOfBirth,
      gender,
      role:userRoleEnum.USER,
    });

    await user.save();

    // Generate token
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

    // Get user data without password
    const userData = user.toJSON();

    return sendResponse(
      res,
      HTTP_STATUS.CREATED,
      SUCCESS_MESSAGES.SIGNUP_SUCCESS,
      userData,
      token
    );
  } catch (error) {
    next(error);
  }
};

/**
 * User Login Controller
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user by email and include password field
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Check if user is active
    if (!user.isActive) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Your account is inactive');
    }

    // Compare passwords
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

    // Get user data without password
    const userData = user.toJSON();

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      SUCCESS_MESSAGES.LOGIN_SUCCESS,
      userData,
      token
    );
  } catch (error) {
    next(error);
  }
};


export const onboarding = async (req, res, next) => {
  try {
    const { dateOfBirth, gender, phone, profilePicture } = req.body;
    const updates = {
      isProfileComplete: true,
      ...pickDefined(
        { dateOfBirth, gender, phone, profilePicture },
        ['dateOfBirth', 'gender', 'phone', 'profilePicture']
      ),
    };

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      updates,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updatedUser) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      SUCCESS_MESSAGES.ONBOARDING_COMPLETE,
      updatedUser
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get Current User Profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.PROFILE_FETCHED, user.toJSON());
  } catch (error) {
    next(error);
  }
};

/**
 * Update User Profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateProfile = async (req, res, next) => {
  try {
    const updates = pickDefined(req.body, [
      'firstName',
      'lastName',
      'phone',
      'dateOfBirth',
      'gender',
      'profilePicture',
    ]);

    const user = await User.findByIdAndUpdate(
      req.userId,
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Profile updated successfully', user.toJSON());
  } catch (error) {
    next(error);
  }
};

/**
 * Change Password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Verify current password
    const isPasswordValid = await comparePassword(currentPassword, user.password);

    if (!isPasswordValid) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Current password is incorrect');
    }

    // Update password
    user.password = newPassword;
    await user.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Logout (Client-side mainly, but can be used for token blacklist if needed)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const logout = async (req, res, next) => {
  try {
    // In a real application, you might want to implement token blacklisting
    // For now, just return success message
    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.LOGOUT_SUCCESS);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete User Account
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;

    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Verify password before deletion
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Password is incorrect');
    }

    user.isActive = false;
    user.email = `deleted_${user._id}_${user.email}`;
    await user.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Account deleted successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Home/dashboard summary used by the Period Buddy landing dashboard.
 */
export const getDashboardSummary = async (req, res, next) => {
  try {
    const [user, settings, logs, habits] = await Promise.all([
      User.findById(req.userId),
      CycleSettings.findOne({ userId: req.userId }),
      CycleLog.find({ userId: req.userId }).sort({ dateKey: -1 }).limit(90),
      Habit.find({ userId: req.userId, isActive: true }),
    ]);

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const trackedDays = logs.filter((log) =>
      log.note?.trim() || (log.symptoms || []).length > 0 || (log.flow && log.flow !== 'none')
    ).length;

    const currentStreak = calculateTrackingStreak(logs);
    if (user.streakCount !== currentStreak) {
      user.streakCount = currentStreak;
      await user.save();
    }

    const today = todayDateKey();
    const completedHabitsToday = habits.filter((habit) => habit.completedDates?.includes(today)).length;
    const forestHealth = Math.min(100, Math.max(45, 55 + trackedDays * 4 + completedHabitsToday * 2));
    const predictions = settings ? computeCyclePredictions(settings) : null;

    return sendResponse(res, HTTP_STATUS.OK, 'Dashboard summary fetched', {
      user: user.toJSON(),
      tokens: user.walletBalance || 0,
      trackedDays,
      forestHealth,
      activeHabits: habits.length,
      predictions,
      recentLogs: logs.slice(0, 7),
    });
  } catch (error) {
    next(error);
  }
};
