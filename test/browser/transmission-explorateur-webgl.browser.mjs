// Public exact-pages proof of transmission composition: same owner on the canvas and on a
// comparison target, the glass never in the host pass, identical repeats, named refusal.
//
//   node --experimental-strip-types test/browser/transmission-explorateur-webgl.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'webglClusterTransmissionExplorerPage.mjs',
  'webglClusterTransmissionExplorerProof',
  'Explorer transmission over autonomous clusters',
  'execute',
);
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
// The red cluster behind the glass, 96 % through at normal incidence, sRGB-encoded on the canvas.
assert.deepEqual(result.repeatPixel, result.canvasPixel, 'A/A: the second frame is the first');
// The comparison target is linear, the canvas is sRGB-encoded: same 0.96 red, two encodings.
assert.deepEqual(result.canvasPixel, [250, 0, 0, 255]);
assert.deepEqual(result.targetPixel, [245, 0, 0, 255], 'the comparison target sees the same');
assert.equal(result.copyDraws, 1, 'the glass is one owned submission');
assert.ok(result.clusterDraws > 0);
assert.equal(result.targetCopyDraws, 1);
assert.equal(result.backdropBytes, 64 * 64 * 12);
assert.equal(result.drawCalls, 2, 'one cluster batch plus one scene copy');
assert.equal(result.transparentMeshes, 1);
assert.equal(result.physicalInHostPass, 0, 'the glass entered WebGLRenderer.render');
assert.ok(result.hostCalls > 0);
assert.deepEqual(result.refusal, {
  code: 'CLUSTER_MATERIAL_UNSUPPORTED',
  reason: 'physical sheen is unsupported',
});
assert.equal(result.drawRefused, true);
