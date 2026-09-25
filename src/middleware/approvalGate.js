import ChangeRequest from '../models/ChangeRequest.js';
import User from '../models/User.js';
import { hasPermission } from '../config/permissions.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendResponse } from '../utils/sendResponse.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';

/** key -> controller handler, so a stored ChangeRequest can be replayed. */
const handlers = new Map();

export const getApprovalHandler = (key) => handlers.get(key);

/**
 * Wrap a controller so users without `directPermission` get a pending
 * ChangeRequest (202) instead of the change being applied.
 *
 * @param {object}   options
 * @param {string}   options.key              Unique registry key, e.g. 'content.update'.
 * @param {string}   options.directPermission Permission that bypasses approval.
 * @param {string}   options.department       Department whose approvers review it.
 * @param {string}   options.action           Short verb for the inbox ('publish', 'delete', …).
 * @param {(req) => string} [options.resourceType]
 * @param {(req) => Promise<boolean>} [options.needsApproval]
 *        Return false to let the request through directly even without
 *        `directPermission` (e.g. editing a draft that isn't live).
 * @param {(req) => Promise<object|undefined>} [options.snapshot]  Current state for a diff.
 * @param {(req, before) => string} [options.summarize]
 * @param {Function} handler  The real controller.
 */
export const withApproval = (options, handler) => {
  const {
    key,
    directPermission,
    department,
    action,
    resourceType,
    needsApproval,
    snapshot,
    summarize,
  } = options;

  if (handlers.has(key)) throw new Error(`Duplicate approval handler key: ${key}`);
  handlers.set(key, handler);

  // Named so scripts/generateSwaggerSpec.js can document the 202 response.
  return async function approvalGate(req, res, next) {
    try {
      if (hasPermission(req.user.role, directPermission)) return handler(req, res, next);
      if (needsApproval && !(await needsApproval(req))) return handler(req, res, next);

      const before = snapshot ? await snapshot(req) : undefined;
      const { requesterNote, ...body } = req.body || {};

      const request = await ChangeRequest.create({
        key,
        department,
        action,
        resourceType: typeof resourceType === 'function' ? resourceType(req) : resourceType,
        resourceId: req.params.id,
        summary: summarize ? summarize(req, before) : undefined,
        params: { ...req.params },
        query: { ...req.query },
        body,
        before,
        requestedBy: req.userId,
        requesterRole: req.user.role,
        requesterNote,
      });

      await recordAudit({
        req,
        action: AUDIT_ACTIONS.CHANGE_REQUEST_CREATED,
        resourceType: 'change_request',
        resourceId: String(request._id),
        metadata: { key, department, targetId: req.params.id },
      });

      return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Submitted for approval', {
        pendingApproval: true,
        request,
      });
    } catch (error) {
      next(error);
    }
  };
};

/** A minimal Express-like response that records what a controller sends. */
const createCaptureResponse = () => {
  const captured = { statusCode: HTTP_STATUS.OK, body: undefined };
  const res = {
    statusCode: HTTP_STATUS.OK,
    headersSent: false,
    locals: {},
    status(code) {
      captured.statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(body) {
      captured.body = body;
      this.headersSent = true;
      return this;
    },
    send(body) {
      captured.body = body;
      this.headersSent = true;
      return this;
    },
    set() {
      return this;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
  };
  return { res, captured };
};

/**
 * Re-run a stored ChangeRequest through its controller. The request acts as
 * the original requester (so authorship fields stay accurate); the approval
 * itself is audited separately against the reviewer.
 *
 * Resolves to `{ ok, statusCode, body }`; never throws for a controller-level
 * rejection (4xx), only for unexpected errors.
 */
export const replayChangeRequest = async (changeRequest, reviewerReq) => {
  const handler = handlers.get(changeRequest.key);
  if (!handler) {
    return {
      ok: false,
      statusCode: 500,
      body: { message: 'This request type is no longer supported' },
    };
  }

  const requester = (await User.findById(changeRequest.requestedBy)) || reviewerReq.user;
  const fakeReq = {
    params: { ...(changeRequest.params || {}) },
    query: { ...(changeRequest.query || {}) },
    body: { ...(changeRequest.body || {}) },
    user: requester,
    userId: String(requester._id),
    ip: reviewerReq.ip,
    headers: {},
    get: () => undefined,
    originalUrl: `change-request:${changeRequest._id}`,
    method: 'REPLAY',
  };
  const { res, captured } = createCaptureResponse();

  await new Promise((resolve, reject) => {
    const nextFn = (error) => (error ? reject(error) : resolve());
    Promise.resolve(handler(fakeReq, res, nextFn)).then(resolve, reject);
  });

  return {
    ok: captured.statusCode < 400,
    statusCode: captured.statusCode,
    body: captured.body,
  };
};
