import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApproval, getApprovalHandler } from '../../middleware/approvalGate.js';

const run = (middleware, role) =>
  new Promise((resolve, reject) => {
    const req = { user: { role }, userId: 'u1', params: {}, query: {}, body: {} };
    Promise.resolve(middleware(req, {}, reject)).then(resolve, reject);
  });

test('holders of the direct permission skip approval', async () => {
  let calls = 0;
  const gate = withApproval(
    { key: 'test.direct', directPermission: 'content.publish', department: 'content', action: 'x' },
    () => {
      calls += 1;
    },
  );
  await run(gate, 'content_super_admin');
  await run(gate, 'admin');
  assert.equal(calls, 2);
});

test('needsApproval=false lets lower-tier staff through', async () => {
  let calls = 0;
  const gate = withApproval(
    {
      key: 'test.draft',
      directPermission: 'content.publish',
      department: 'content',
      action: 'x',
      needsApproval: async () => false,
    },
    () => {
      calls += 1;
    },
  );
  await run(gate, 'content_admin');
  assert.equal(calls, 1);
});

test('handlers are registered for replay and keys are unique', () => {
  const handler = () => {};
  withApproval(
    { key: 'test.unique', directPermission: 'x', department: 'content', action: 'x' },
    handler,
  );
  assert.equal(getApprovalHandler('test.unique'), handler);
  assert.throws(() =>
    withApproval(
      { key: 'test.unique', directPermission: 'x', department: 'content', action: 'x' },
      handler,
    ),
  );
});
