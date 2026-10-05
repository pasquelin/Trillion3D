import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleControl } from './scaleControl.ts';
import { simulate } from './scaleFit.fixture.ts';

const OTHER = 0.6,
  RUN = 600;

// A fit a bound clamps goes exactly to the bound: from 0.504 the step to the floor is under the
// threshold, and the scale stayed there (#831).
test('a page over budget ends exactly at the floor, whatever the cost it started from', () => {
  for (let g = 33; g <= 120; g++) {
    const control = createScaleControl('auto'),
      { scales } = simulate(control, RUN, { gpu: (s) => g * s * s, other: () => OTHER });
    assert.equal(control.wanted(), 0.5, `${g} ms at full scale`);
    assert.equal(scales.at(-1), 0.5);
  }
});

test('a page under budget ends exactly at the maximum', () => {
  for (const g of [1, 2, 3, 4]) {
    const control = createScaleControl('auto');
    simulate(control, RUN, { gpu: (s) => g * s * s, other: () => OTHER });
    assert.equal(control.wanted(), 1, `${g} ms at full scale`);
  }
});
