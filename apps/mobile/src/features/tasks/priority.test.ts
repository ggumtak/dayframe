import assert from 'node:assert/strict';
import { test } from 'node:test';

import { priorityA11y, priorityLabel } from './priority.ts';

test('priorities read as words, matching the priority sheets', () => {
  assert.deepEqual([1, 2, 3, 4].map((p) => priorityLabel(p as 1 | 2 | 3 | 4)), ['가장 높음', '높음', '보통', '없음']);
  assert.equal(priorityA11y(2), '우선순위 높음');
  assert.equal(priorityA11y(4), '우선순위 없음');
});
