import assert from 'node:assert/strict';
import { test } from 'node:test';

import { priorityA11y, priorityLabel, priorityMark, priorityOption, taskA11yLabel } from './priority.ts';

test('priority is a mark before the title, not a colour', () => {
  assert.deepEqual([1, 2, 3, 4].map((p) => priorityMark(p as 1 | 2 | 3 | 4)), ['!!!', '!!', '!', '']);
  assert.deepEqual([1, 2, 3, 4].map((p) => priorityOption(p as 1 | 2 | 3 | 4)), ['!!! 가장 높음', '!! 높음', '! 보통', '없음']);
});

test('screen readers hear the priority in words, never the marks', () => {
  assert.equal(taskA11yLabel('분기 보고서 초안 제출', 1), '우선순위 가장 높음, 분기 보고서 초안 제출');
  assert.equal(taskA11yLabel('디자인 리뷰', 2), '우선순위 높음, 디자인 리뷰');
  assert.equal(taskA11yLabel('팀 스탠드업', 3), '우선순위 보통, 팀 스탠드업');
  assert.equal(taskA11yLabel('우유 사기', 4), '우유 사기');
});

test('priorities read as words, matching the priority sheets', () => {
  assert.deepEqual([1, 2, 3, 4].map((p) => priorityLabel(p as 1 | 2 | 3 | 4)), ['가장 높음', '높음', '보통', '없음']);
  assert.equal(priorityA11y(2), '우선순위 높음');
  assert.equal(priorityA11y(4), '우선순위 없음');
});
