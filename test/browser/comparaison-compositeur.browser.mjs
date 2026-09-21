// Proof by the real render: the comparison compositor is an engine program that composes two
// render targets in every layout, each side through the display chain its engine would apply
// on the canvas. Before, the compositor was a `ShaderMaterial` whose fragment named a uniform
// `layout` — reserved in GLSL ES 3.00 — and never compiled: every comparison showed the clear
// colour (#85).
//
//   node --experimental-strip-types test/browser/comparaison-compositeur.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'comparisonCompositorPage.mjs',
  'comparisonCompositorProof',
  'Engine comparison compositor',
  'execute',
);
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
const { layouts } = result;
// Linear 0.5 red, unlit: encoded once, 188, by the same curve as the single view.
const red = [188, 0, 0, 255];
assert.deepEqual(layouts.single.left, red);
assert.deepEqual(layouts.single.right, red, 'single shows the first side everywhere');
const blue = layouts.toggled.right;
assert.deepEqual(layouts.toggled.left, blue, 'toggle 1 shows the second side everywhere');
assert.ok(blue[2] > 0 && blue[0] === 0 && blue[1] === 0, `a blue side: ${blue}`);
assert.notEqual(blue[2], 188, 'the lit side went through the filmic curve, not the identity');
assert.deepEqual(layouts.unlitB.right, [0, 0, 188, 255], 'unlit, the same side is the identity');
assert.deepEqual(layouts['side-by-side'], { left: red, right: blue });
assert.deepEqual(layouts.wipe, { left: red, right: blue }, 'the wipe at one half');
assert.deepEqual(layouts.toggle, { left: red, right: red }, 'toggle 0 shows the first side');
const difference = red.map((value, i) => (i === 3 ? 255 : Math.abs(value - blue[i])));
assert.deepEqual(layouts.difference, { left: difference, right: difference });
