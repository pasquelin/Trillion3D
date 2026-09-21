// Proof by the real render: the comparison compositor is an engine program that composes two
// render targets in every layout, texel for texel — a side is the display image its engine drew.
// Before, the compositor was a `ShaderMaterial` whose fragment named a uniform `layout` —
// reserved in GLSL ES 3.00 — and never compiled: every comparison showed the clear colour (#85).
//
//   node --experimental-strip-types test/browser/comparaison-compositeur.browser.mjs
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../appui/preuvePageMoteur.ts';

interface Resultat extends ResultatPagePreuve {
  layouts: Record<string, { left: number[]; right: number[] }>;
}

const result = (await preuveDansLaPage(
  'comparisonCompositorPage.ts',
  'comparisonCompositorProof',
  'Engine comparison compositor',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
const { layouts } = result;
// The display bytes each target holds, as they were written: 0.6 of 255.
const red = [153, 0, 0, 255],
  blue = [0, 0, 153, 255];
assert.deepEqual(layouts.single.left, red);
assert.deepEqual(layouts.single.right, red, 'single shows the first side everywhere');
assert.deepEqual(layouts.toggled, { left: blue, right: blue }, 'toggle 1 shows the second side');
assert.deepEqual(layouts['side-by-side'], { left: red, right: blue });
assert.deepEqual(layouts.wipe, { left: red, right: blue }, 'the wipe at one half');
assert.deepEqual(layouts.toggle, { left: red, right: red }, 'toggle 0 shows the first side');
const difference = red.map((value, i) => (i === 3 ? 255 : Math.abs(value - blue[i])));
assert.deepEqual(layouts.difference, { left: difference, right: difference });
