// Real-browser proof for the engine-owned WebGL2 surface: drawing survives a no-op resize,
// a physical resize uses the declared DPR, loss is recoverable, and disposal owns the context.
//
//   node --experimental-strip-types test/browser/webgl-surface.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'webglSurfacePage.mjs',
  'webglSurfaceProof',
  'Engine-owned WebGL2 surface',
  'execute',
);
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.deepEqual(result.before, [255, 0, 0, 255]);
assert.deepEqual(
  result.afterSameSize,
  result.before,
  'same-size resize cleared the drawing buffer',
);
assert.deepEqual(result.afterResize, [0, 255, 0, 255]);
assert.deepEqual(result.afterRestore, [0, 0, 255, 255]);
assert.deepEqual(result.size, {
  width: 16,
  height: 8,
  pixelRatio: 2,
  drawingWidth: 32,
  drawingHeight: 16,
});
assert.equal(result.disposed, true);
assert.equal(result.contextLostAfterDispose, true);
assert.deepEqual(result.events, ['lost', 'restored'], 'dispose must not notify removed listeners');
