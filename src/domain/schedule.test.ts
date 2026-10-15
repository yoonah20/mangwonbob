import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueWeekKey } from './schedule.js';

test('weekly is due from Friday 16:30 Seoul until Sunday night', () => {
  // 2026-10-16 is a Friday. 16:29 KST = 07:29 UTC
  assert.equal(dueWeekKey(new Date('2026-10-16T07:29:00Z')), null);
  assert.equal(dueWeekKey(new Date('2026-10-16T07:30:00Z')), '2026-10-16');
  assert.equal(dueWeekKey(new Date('2026-10-17T03:00:00Z')), '2026-10-16'); // Saturday
  assert.equal(dueWeekKey(new Date('2026-10-18T14:00:00Z')), '2026-10-16'); // Sunday 23:00 KST
  assert.equal(dueWeekKey(new Date('2026-10-18T15:00:00Z')), null); // Monday 00:00 KST
  assert.equal(dueWeekKey(new Date('2026-10-14T03:00:00Z')), null); // Wednesday
});
