// The comparison compositor is an engine program that composes two render targets texel for texel
// in every layout, in Chrome: a side is the display image its engine drew, shown as it was written,
// and a difference is the difference of what the two single views show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { inChrome } from '../kit/onChrome.ts';
import type { execute } from './comparisonCompositorPage.ts';

const PAGE = resolve(import.meta.dirname, 'comparisonCompositorPage.ts');

test('the comparison compositor shows each side texel for texel', { timeout: 60_000 }, async () => {
  const layouts = await inChrome<ReturnType<typeof execute>>(PAGE, 'execute');
  console.log(JSON.stringify(layouts));
  // The display bytes each target holds, as they were written: 0.6 of 255.
  const red = [153, 0, 0, 255],
    blue = [0, 0, 153, 255];
  assert.deepEqual(layouts.single, { left: red, right: red }, 'single shows the first side');
  assert.deepEqual(layouts.toggled, { left: blue, right: blue }, 'toggle 1 shows the second side');
  assert.deepEqual(layouts['side-by-side'], { left: red, right: blue });
  assert.deepEqual(layouts.wipe, { left: red, right: blue }, 'the wipe at one half');
  assert.deepEqual(layouts.toggle, { left: red, right: red }, 'toggle 0 shows the first side');
  const difference = red.map((value, i) => (i === 3 ? 255 : Math.abs(value - blue[i])));
  assert.deepEqual(layouts.difference, { left: difference, right: difference });
});
