import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFIED_LABEL,
  countExpertAnswers,
  doctorDisplayName,
  expertAuthor,
  expertSnapshot,
  publicExpert,
} from '../communityExpert.js';

test('doctorDisplayName adds Dr. once', () => {
  assert.equal(doctorDisplayName('Priya Sharma'), 'Dr. Priya Sharma');
  assert.equal(doctorDisplayName('Dr. Priya Sharma'), 'Dr. Priya Sharma');
  assert.equal(doctorDisplayName('dr priya'), 'Dr. priya');
  assert.equal(doctorDisplayName('Drishti Rao'), 'Dr. Drishti Rao');
  assert.equal(doctorDisplayName('  '), '');
});

test('the name and photo are only shown when the doctor chose to', () => {
  const doctor = {
    _id: 'd1',
    name: 'Priya Sharma',
    specialty: 'Gynecologist',
    avatarUrl: 'https://x/a.jpg',
  };

  const named = expertSnapshot(doctor, true);
  assert.deepEqual(publicExpert(named), {
    verified: true,
    showName: true,
    name: 'Dr. Priya Sharma',
    specialty: 'Gynecologist',
    avatarUrl: 'https://x/a.jpg',
  });
  assert.equal(expertAuthor(named).firstName, 'Dr. Priya Sharma');

  const hidden = expertSnapshot(doctor, undefined);
  assert.equal(hidden.showName, false, 'hidden unless asked');
  assert.deepEqual(publicExpert(hidden), {
    verified: true,
    showName: false,
    name: null,
    specialty: 'Gynecologist',
    avatarUrl: null,
  });
  assert.deepEqual(expertAuthor(hidden), {
    firstName: VERIFIED_LABEL,
    lastName: '',
    profilePicture: null,
  });
  assert.equal('doctorId' in publicExpert(hidden), false, 'the doctor id stays on the server');
});

test('countExpertAnswers counts only gynecologist answers', () => {
  assert.equal(
    countExpertAnswers([{ content: 'a' }, { expert: { doctorId: 'd1' } }, { expert: {} }]),
    1,
  );
  assert.equal(countExpertAnswers(undefined), 0);
});
