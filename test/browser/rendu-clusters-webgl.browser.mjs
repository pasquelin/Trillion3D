// Real-browser proof that the cluster renderer draws its own program into the host canvas and
// respects an sRGB framebuffer's scissor instead of replacing the remaining host pass.
//
//   node --experimental-strip-types test/browser/rendu-clusters-webgl.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'webglClusterRendererPage.mjs',
  'webglClusterRendererProof',
  'Autonomous WebGL2 cluster renderer',
  'execute',
);
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.deepEqual(result.canvasCenter, [118, 0, 0, 255]);
assert.deepEqual(result.fboInside, [118, 0, 0, 255]);
assert.deepEqual(result.fboOutside, [0, 0, 255, 255]);
assert.equal(result.framebufferStatus, 36053);
assert.equal(result.drawError, 0);
assert.deepEqual(result.ambient, [118, 0, 0, 255]);
assert.deepEqual(result.direct, [70, 10, 10, 255]);
assert.deepEqual(result.translatedDirect, result.direct);
assert.ok(result.directWitness[0] > 0);
assert.deepEqual(result.neutralNormal, result.direct);
assert.equal(result.invisibleSubmissions, 0);
assert.equal(result.rejected, true);
assert.deepEqual(result.textures, {
  linearMap: [118, 118, 118, 255],
  linearEmissive: [118, 118, 118, 255],
  uv1Transform: [255, 255, 0, 255],
});
assert.equal(result.decayRejected, true);
assert.deepEqual(result.heldRestore, { draws: 2, restoredPixel: [0, 255, 0, 255] });
assert.ok(result.curved.every((entry) => entry.rawNonBlack > 500));
const span = (values) => Math.max(...values) - Math.min(...values);
const rawMotion = result.curvedMotion.map((frame) => frame.rawCenter[0]);
const referenceMotion = result.curvedMotion.map((frame) => frame.referenceCenter[0]);
assert.ok(span(rawMotion) <= span(referenceMotion));
