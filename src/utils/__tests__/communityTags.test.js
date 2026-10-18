import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMMUNITY_TAGS,
  normalizeCommunityTags,
  sanitizeCommunityTag,
} from '../communityTags.js';

test('a tag loses its #, unsafe characters and extra spaces', () => {
  assert.equal(sanitizeCommunityTag('  #cramps '), 'cramps');
  assert.equal(sanitizeCommunityTag('##late   period'), 'late period');
  assert.equal(sanitizeCommunityTag('<script>alert(1)</script>'), 'scriptalert1script');
  assert.equal(sanitizeCommunityTag('pcos-help_2'), 'pcos-help_2');
  assert.equal(sanitizeCommunityTag('मासिक धर्म'), 'मासिक धर्म');
  assert.equal(sanitizeCommunityTag('#'), '');
  assert.equal(sanitizeCommunityTag(null), '');
});

test('tags are deduped ignoring case, first spelling wins, blanks dropped', () => {
  assert.deepEqual(normalizeCommunityTags(['PCOS', '#pcos', ' ', 'Sleep']).tags, ['PCOS', 'Sleep']);
  assert.deepEqual(normalizeCommunityTags('cramps, #Cramps,sleep').tags, ['cramps', 'sleep']);
  assert.deepEqual(normalizeCommunityTags(undefined).tags, []);
});

test('too many or too long tags are rejected', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(six.length, MAX_COMMUNITY_TAGS + 1);
  assert.match(normalizeCommunityTags(six).error, /at most 5 tags/);
  // Duplicates don't count toward the limit.
  assert.equal(normalizeCommunityTags([...six.slice(0, 5), 'A']).error, undefined);
  assert.match(normalizeCommunityTags(['x'.repeat(25)]).error, /at most 24 characters/);
  assert.equal(normalizeCommunityTags(['x'.repeat(24)]).error, undefined);
  assert.equal(normalizeCommunityTags([{ $gt: '' }]).error, 'Invalid tag');
});
