import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_STATES,
  REVIEW_ACTIONS,
  canPerformReviewAction,
  changedReviewedFields,
  clearedReviewStamp,
  contentState,
  describeReview,
  normalizeReviewAction,
  normalizeReviewNote,
  planReviewTransition,
  reviewStamp,
  reviewerDisplayName,
  reviewerForRequest,
  shouldClearReviewStamp,
  stripReviewFields,
} from '../medicalReview.js';
import { resolveVisibilityInput } from '../../controllers/contentController.js';

const { SUBMIT, APPROVE, MARK_REVIEWED, SEND_BACK } = REVIEW_ACTIONS;
const { PUBLISHED, DRAFT, IN_REVIEW, ARCHIVED } = CONTENT_STATES;

test('review actions accept the portal labels', () => {
  assert.equal(normalizeReviewAction('submit'), SUBMIT);
  assert.equal(normalizeReviewAction('approve_and_publish'), APPROVE);
  assert.equal(normalizeReviewAction('mark-reviewed'), MARK_REVIEWED);
  assert.equal(normalizeReviewAction('send back'), SEND_BACK);
  assert.equal(normalizeReviewAction('delete'), null);
  assert.equal(normalizeReviewAction(undefined), null);
});

test('writers submit, only content.approve holders decide', () => {
  for (const role of ['content_admin', 'content_super_admin', 'admin']) {
    assert.equal(canPerformReviewAction(role, SUBMIT), true, role);
  }
  for (const action of [APPROVE, MARK_REVIEWED, SEND_BACK]) {
    assert.equal(canPerformReviewAction('content_admin', action), false, action);
    assert.equal(canPerformReviewAction('content_super_admin', action), true, action);
    assert.equal(canPerformReviewAction('admin', action), true, action);
    assert.equal(canPerformReviewAction('app_admin', action), false, action);
    assert.equal(canPerformReviewAction('user', action), false, action);
  }
  assert.equal(canPerformReviewAction('app_super_admin', SUBMIT), false);
  assert.equal(canPerformReviewAction('admin', 'nope'), false);
});

test('content states', () => {
  assert.equal(contentState({ live: true, inReview: true }), PUBLISHED);
  assert.equal(contentState({ live: false, inReview: true }), IN_REVIEW);
  assert.equal(contentState({ live: false, archived: true }), ARCHIVED);
  assert.equal(contentState({ live: false }), DRAFT);
});

test('status transitions', () => {
  assert.deepEqual(planReviewTransition(SUBMIT, DRAFT), { ok: true, nextState: IN_REVIEW });
  for (const from of [IN_REVIEW, PUBLISHED, ARCHIVED]) {
    assert.equal(planReviewTransition(SUBMIT, from).ok, false, from);
  }

  assert.deepEqual(planReviewTransition(APPROVE, IN_REVIEW), { ok: true, nextState: PUBLISHED });
  for (const from of [DRAFT, PUBLISHED, ARCHIVED]) {
    assert.equal(planReviewTransition(APPROVE, from).ok, false, from);
  }

  assert.equal(planReviewTransition(MARK_REVIEWED, IN_REVIEW).nextState, DRAFT);
  assert.equal(planReviewTransition(MARK_REVIEWED, DRAFT).nextState, DRAFT);
  assert.equal(planReviewTransition(MARK_REVIEWED, PUBLISHED).nextState, PUBLISHED);
  assert.equal(planReviewTransition(MARK_REVIEWED, ARCHIVED).ok, false);

  assert.deepEqual(planReviewTransition(SEND_BACK, IN_REVIEW), { ok: true, nextState: DRAFT });
  assert.equal(planReviewTransition(SEND_BACK, DRAFT).ok, false);
  assert.match(planReviewTransition(SEND_BACK, DRAFT).error, /not awaiting review/);

  assert.equal(planReviewTransition('bogus', DRAFT).ok, false);
});

test('send back needs a short note', () => {
  assert.ok(normalizeReviewNote('', { required: true }).error);
  assert.ok(normalizeReviewNote('   ', { required: true }).error);
  assert.deepEqual(normalizeReviewNote('  fix dosage  ', { required: true }), {
    note: 'fix dosage',
  });
  assert.deepEqual(normalizeReviewNote(undefined), { note: null });
  assert.ok(normalizeReviewNote('x'.repeat(501)).error);
});

test('reviewer name comes from the User record', () => {
  assert.equal(reviewerDisplayName({ firstName: 'Asha', lastName: 'Rao' }), 'Asha Rao');
  assert.equal(reviewerDisplayName({ firstName: 'Asha', lastName: '' }), 'Asha');
  assert.equal(reviewerDisplayName({ firstName: ' ', email: 'dr@nura.care' }), 'dr@nura.care');
  assert.equal(reviewerDisplayName(null), 'Nura team');
});

test('stamp is built on the server and cleared in full', () => {
  const now = new Date('2026-10-16T10:00:00Z');
  const stamp = reviewStamp(
    { _id: 'u1', firstName: 'Asha', lastName: 'Rao', role: 'content_super_admin' },
    { note: 'ok', now },
  );
  assert.deepEqual(stamp, {
    medicallyReviewed: true,
    reviewedBy: 'Asha Rao',
    reviewedById: 'u1',
    reviewedAt: now,
    reviewNote: 'ok',
  });
  const cleared = clearedReviewStamp();
  assert.equal(cleared.medicallyReviewed, false);
  for (const field of ['reviewedBy', 'reviewedById', 'reviewedAt', 'reviewNote']) {
    assert.equal(cleared[field], null, field);
  }
});

test('clients can never send the stamp', () => {
  const body = stripReviewFields({
    title: 't',
    medicallyReviewed: true,
    reviewedBy: 'Dr Fake',
    reviewedAt: '2020-01-01',
    inReview: true,
    review: {},
  });
  assert.deepEqual(body, { title: 't' });
});

test('the reviewer is the actor, or the approver of their change request', () => {
  const writer = { _id: 'w', role: 'content_admin' };
  const approver = { _id: 'a', role: 'content_super_admin' };
  assert.equal(reviewerForRequest({ user: approver }), approver);
  assert.equal(reviewerForRequest({ user: writer }), null);
  assert.equal(reviewerForRequest({ user: writer, approvedBy: approver }), approver);
  assert.equal(reviewerForRequest({ user: writer, approvedBy: writer }), null);
});

test('only real changes to the medical substance count', () => {
  const current = { title: 'Cramps', content: 'Body', excerpt: 'Short', tags: ['a'] };
  // The form resends everything on each save.
  assert.deepEqual(
    changedReviewedFields('blog', current, { title: ' Cramps ', content: 'Body', tags: ['b'] }),
    [],
  );
  assert.deepEqual(changedReviewedFields('blog', current, { content: 'New body' }), ['content']);
  assert.deepEqual(
    changedReviewedFields(
      'health-issue',
      { symptoms: ['pain', 'fever'] },
      { symptoms: ['pain', 'fever', 'nausea'] },
    ),
    ['symptoms'],
  );
  assert.deepEqual(changedReviewedFields('wellbeing', { extendedGuide: [] }, { order: 3 }), []);
  assert.deepEqual(changedReviewedFields('question-answer', {}, { answer: 'A' }), ['answer']);
  assert.deepEqual(changedReviewedFields('video', { title: 'x' }, { category: 'y' }), []);
});

test('a non-reviewer editing a reviewed item clears the stamp', () => {
  const changedFields = ['content'];
  assert.equal(shouldClearReviewStamp({ reviewer: null, stamped: true, changedFields }), true);
  assert.equal(
    shouldClearReviewStamp({ reviewer: { role: 'admin' }, stamped: true, changedFields }),
    false,
  );
  assert.equal(shouldClearReviewStamp({ reviewer: null, stamped: false, changedFields }), false);
  assert.equal(shouldClearReviewStamp({ reviewer: null, stamped: true, changedFields: [] }), false);
});

test('admin review summary', () => {
  assert.deepEqual(describeReview({}), {
    medicallyReviewed: false,
    by: null,
    at: null,
    note: null,
    submittedAt: null,
    submittedBy: null,
    sentBackAt: null,
    sentBackBy: null,
    sentBackNote: null,
  });
  const at = new Date();
  const review = describeReview({
    medicallyReviewed: true,
    reviewedBy: 'Asha Rao',
    reviewedAt: at,
    reviewWorkflow: { sentBackNote: 'cite sources' },
  });
  assert.equal(review.by, 'Asha Rao');
  assert.equal(review.at, at);
  assert.equal(review.sentBackNote, 'cite sources');
});

test('in_review is a hidden status that never publishes', () => {
  assert.deepEqual(resolveVisibilityInput({ status: 'in_review' }), {
    provided: true,
    value: false,
    inReview: true,
  });
  assert.equal(resolveVisibilityInput({ status: 'in_review' }, true).value, false);
});
