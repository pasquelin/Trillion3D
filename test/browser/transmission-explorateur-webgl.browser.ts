// Public exact-pages proof of transmission composition: same owner on the canvas and on a
// comparison target, the glass never in the host pass, identical repeats, named refusal.
//
//   node --experimental-strip-types test/browser/transmission-explorateur-webgl.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../appui/preuvePageMoteur.ts';

interface Refusal {
  code: string;
  reason: string;
}

interface Resultat extends ResultatPagePreuve {
  repeatPixel: number[];
  canvasPixel: number[];
  targetPixel: number[];
  copyDraws: number;
  clusterDraws: number;
  targetCopyDraws: number;
  backdropBytes: number;
  drawCalls: number;
  transparentMeshes: number;
  physicalInHostPass: number;
  hostCalls: number;
  wireframe: { copyDraws: number; drawCalls: number };
  mutationRefusal: Refusal;
  refusal: Refusal;
  drawRefusal: Refusal;
}

const result = (await preuveDansLaPage(
  'webglClusterTransmissionExplorerPage.ts',
  'webglClusterTransmissionExplorerProof',
  'Explorer transmission over autonomous clusters',
  'execute',
)) as Resultat;
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
assert.equal(result.drawCalls, 3, 'the backdrop pass, the display pass and the scene copy');
assert.equal(result.transparentMeshes, 1);
assert.equal(result.physicalInHostPass, 0, 'the glass entered WebGLRenderer.render');
assert.ok(result.hostCalls > 0);
assert.deepEqual(
  result.wireframe,
  { copyDraws: 1, drawCalls: 2 },
  'the painted glass is drawn as a whole mesh, without a backdrop pass',
);
assert.deepEqual(
  result.mutationRefusal,
  { code: 'CLUSTER_MATERIAL_UNSUPPORTED', reason: 'physical clearcoat is unsupported' },
  'a mutation after the preparation is refused by the same name',
);
assert.deepEqual(result.refusal, {
  code: 'CLUSTER_MATERIAL_UNSUPPORTED',
  reason: 'physical sheen is unsupported',
});
assert.deepEqual(result.drawRefusal, result.refusal, 'the draw refuses by the same name');
