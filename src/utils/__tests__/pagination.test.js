import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPagination, getPagination, isPaginatedRequest } from '../apiHelpers.js';

test('only page or limit opts into pagination', () => {
  assert.equal(isPaginatedRequest({}), false);
  assert.equal(isPaginatedRequest({ search: 'x', status: 'paid' }), false);
  assert.equal(isPaginatedRequest({ page: '2' }), true);
  assert.equal(isPaginatedRequest({ limit: '10' }), true);
});

test('getPagination clamps to maxLimit and falls back on bad input', () => {
  assert.deepEqual(getPagination({ page: '3', limit: '500' }, { limit: 20, maxLimit: 50 }), {
    page: 3,
    limit: 50,
    skip: 100,
  });
  assert.deepEqual(getPagination({ page: 'abc' }, { limit: 20 }), { page: 1, limit: 20, skip: 0 });
});

test('buildPagination reports whether more pages exist', () => {
  assert.deepEqual(buildPagination({ page: 1, limit: 20, total: 45 }), {
    page: 1,
    limit: 20,
    total: 45,
    pages: 3,
    hasNextPage: true,
    hasPrevPage: false,
  });
  assert.equal(buildPagination({ page: 3, limit: 20, total: 45 }).hasNextPage, false);
});
