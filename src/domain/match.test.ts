import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, nameSimilarity, bestMatch } from './match.js';

test('normalizeName drops branch suffixes and symbols', () => {
  assert.equal(normalizeName('동래정 망원점'), '동래정');
  assert.equal(normalizeName('정각 서울망원본점'), '정각');
  assert.equal(normalizeName('가원 망원본점'), '가원');
  assert.equal(normalizeName('오하루수육국밥'), '오하루수육국밥');
  assert.equal(normalizeName('Pizza Forza (피자포르짜)'), 'pizzaforza');
});

test('similar names score high, different ones low', () => {
  assert.equal(nameSimilarity('동래정 망원점', '동래정'), 1);
  assert.ok(nameSimilarity('망원시장손칼국수', '망원시장 손칼국수') === 1);
  assert.ok(nameSimilarity('오복식당', '육장') < 0.2);
});

test('bestMatch needs a close and similar candidate', () => {
  assert.equal(bestMatch('동래정 망원점', [
    { id: 'far', name: '동래정', distanceM: 300 },
    { id: 'near', name: '동래정', distanceM: 12 },
  ]), 'near');
  assert.equal(bestMatch('오복식당', [{ id: 'x', name: '육장', distanceM: 10 }]), null);
  assert.equal(bestMatch('스키야 망원', [{ id: 'y', name: 'Sukiya Mangwon 스키야', distanceM: 15 }]), 'y');
});
