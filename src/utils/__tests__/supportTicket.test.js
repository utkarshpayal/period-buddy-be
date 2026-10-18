import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_MAX,
  SUBJECT_MAX,
  SUPPORT_CATEGORY_IDS,
  TICKET_NUMBER_REGEX,
  formatTicketNumber,
  parseAdminUpdate,
  parseReplyInput,
  parseStatusFilter,
  parseTicketInput,
  previewOf,
  sanitizeMeta,
  statusAfterReply,
  supportInbox,
  ticketRoute,
  userCanReply,
} from '../supportTicket.js';
import { isValidNotificationRoute } from '../notificationRoute.js';
import { PERMISSIONS as P, STAFF_ROLES, hasPermission } from '../../config/permissions.js';

test('ticket numbers are NURA- plus at least six digits', () => {
  assert.equal(formatTicketNumber(123), 'NURA-000123');
  assert.equal(formatTicketNumber(1), 'NURA-000001');
  assert.equal(formatTicketNumber(1234567), 'NURA-1234567');
  assert.ok(TICKET_NUMBER_REGEX.test(formatTicketNumber(42)));
  assert.equal(TICKET_NUMBER_REGEX.test('NURA-12'), false);
});

test('categories match the app chips', () => {
  assert.deepEqual(SUPPORT_CATEGORY_IDS, [
    'account',
    'period_tracking',
    'payments',
    'consultation',
    'bug',
    'other',
  ]);
});

test('parseTicketInput validates category, subject and message', () => {
  const ok = parseTicketInput({
    category: 'bug',
    subject: '  App  crashes\non open ',
    message: '  It closes every time I open the tracker.  ',
  });
  assert.deepEqual(ok.value, {
    category: 'bug',
    subject: 'App  crashes on open',
    message: 'It closes every time I open the tracker.',
    meta: null,
  });
  assert.ok(
    parseTicketInput({ category: 'nope', subject: 'Hello', message: 'x'.repeat(20) }).error,
  );
  assert.ok(parseTicketInput({ category: 'bug', subject: 'a', message: 'x'.repeat(20) }).error);
  assert.ok(parseTicketInput({ category: 'bug', subject: 'Hello', message: 'short' }).error);
  assert.ok(
    parseTicketInput({
      category: 'bug',
      subject: 's'.repeat(SUBJECT_MAX + 1),
      message: 'x'.repeat(20),
    }).error,
  );
  assert.ok(
    parseTicketInput({ category: 'bug', subject: 'Hello', message: 'x'.repeat(MESSAGE_MAX + 1) })
      .error,
  );
});

test('app info is kept only when the person opted in, and only known keys', () => {
  const base = { category: 'other', subject: 'Hello', message: 'x'.repeat(20) };
  const meta = { platform: 'android', appVersion: '1.4.0', secret: 'no', timezoneOffset: 330 };
  assert.equal(parseTicketInput({ ...base, meta }).value.meta, null);
  assert.deepEqual(parseTicketInput({ ...base, attachAppInfo: true, meta }).value.meta, {
    platform: 'android',
    appVersion: '1.4.0',
    timezoneOffset: 330,
  });
  assert.equal(sanitizeMeta(null), null);
  assert.equal(sanitizeMeta(['x']), null);
  assert.equal(sanitizeMeta({ timezoneOffset: 99999 }), null);
  assert.equal(sanitizeMeta({ deviceModel: 'x'.repeat(500) }).deviceModel.length, 100);
});

test('parseReplyInput', () => {
  assert.deepEqual(parseReplyInput({ message: ' thanks! ' }).value, { message: 'thanks!' });
  assert.ok(parseReplyInput({ message: '   ' }).error);
  assert.ok(parseReplyInput({}).error);
  assert.ok(parseReplyInput({ message: 'x'.repeat(5000) }).error);
});

test('parseAdminUpdate only accepts known values', () => {
  assert.deepEqual(parseAdminUpdate({ status: 'resolved' }).value, { status: 'resolved' });
  assert.deepEqual(parseAdminUpdate({ priority: 'urgent', assignee: null }).value, {
    priority: 'urgent',
    assignee: null,
  });
  assert.deepEqual(parseAdminUpdate({ assignee: 'a'.repeat(24) }).value, {
    assignee: 'a'.repeat(24),
  });
  assert.ok(parseAdminUpdate({ status: 'done' }).error);
  assert.ok(parseAdminUpdate({ priority: 'max' }).error);
  assert.ok(parseAdminUpdate({ assignee: 'bob' }).error);
  assert.ok(parseAdminUpdate({}).error);
});

test('status moves with replies', () => {
  assert.equal(statusAfterReply('resolved', 'user'), 'open');
  assert.equal(statusAfterReply('in_progress', 'user'), 'in_progress');
  assert.equal(statusAfterReply('open', 'admin'), 'in_progress');
  assert.equal(statusAfterReply('resolved', 'admin'), 'resolved');
  assert.equal(userCanReply('closed'), false);
  assert.equal(userCanReply('resolved'), true);
});

test('parseStatusFilter', () => {
  assert.deepEqual(parseStatusFilter('active'), ['open', 'in_progress']);
  assert.deepEqual(parseStatusFilter('open,closed,bogus'), ['open', 'closed']);
  assert.equal(parseStatusFilter('bogus'), null);
  assert.equal(parseStatusFilter(undefined), null);
});

test('ticket route is a valid in-app notification route', () => {
  assert.equal(
    ticketRoute('65f0c0ffee0000000000abcd'),
    '/support-tickets?id=65f0c0ffee0000000000abcd',
  );
  assert.ok(isValidNotificationRoute(ticketRoute('65f0c0ffee0000000000abcd')));
});

test('support inbox falls back SUPPORT_EMAIL → CONTACT_RECEIVER_EMAIL → published address', () => {
  assert.equal(supportInbox({ SUPPORT_EMAIL: 'a@x', CONTACT_RECEIVER_EMAIL: 'b@x' }), 'a@x');
  assert.equal(supportInbox({ CONTACT_RECEIVER_EMAIL: 'b@x' }), 'b@x');
  assert.equal(supportInbox({}), 'hello@thenura.care');
});

test('previewOf flattens and trims', () => {
  assert.equal(previewOf('a\n\nb   c'), 'a b c');
  assert.equal(previewOf('x'.repeat(200), 10).length, 10);
});

test('support permissions: Super Admin and the App department', () => {
  const holders = Object.keys(STAFF_ROLES).filter((role) => hasPermission(role, P.SUPPORT_READ));
  assert.deepEqual(holders.sort(), ['admin', 'app_admin', 'app_super_admin']);
  for (const role of holders) assert.ok(hasPermission(role, P.SUPPORT_MANAGE));
  assert.equal(hasPermission('content_admin', P.SUPPORT_READ), false);
  assert.equal(hasPermission('clinical_admin', P.SUPPORT_MANAGE), false);
});
