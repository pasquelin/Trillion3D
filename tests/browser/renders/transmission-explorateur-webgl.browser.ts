// Public exact-pages proof of the scene copies: same owner on the canvas and on a comparison
// target, the glass then the blended quad, no mesh in the host scene, identical repeats, named
// refusal.
//
//   node --experimental-strip-types tests/browser/renders/transmission-explorateur-webgl.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/preuvePageMoteur.ts';

interface Refusal {
  code: string;
  reason: string;
}

interface Resultat extends ResultatPagePreuve {
  repeatPixel: number[];
  canvasPixel: number[];
  blendedPixel: number[];
  targetPixel: number[];
  copyDraws: number;
  clusterDraws: number;
  targetCopyDraws: number;
  backdropBytes: number;
  drawCalls: number;
  transparentMeshes: number;
  meshesInHostPass: number;
  hostCalls: number;
  wireframe: { copyDraws: number; drawCalls: number };
  mutationRefusal: Refusal;
  refusal: Refusal;
  drawRefusal: Refusal;
}

const result = (await preuveDansLaPage(
  'webglClusterTransmissionExplorerPage.ts',
  'webglClusterTransmissionExplorerProof',
  'MeasuredWorld transmission over autonomous clusters',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
// The red cluster behind the glass, 96 % through at normal incidence, sRGB-encoded on the canvas.
assert.deepEqual(result.repeatPixel, result.canvasPixel, 'A/A: the second frame is the first');
// The comparison target holds the display image: the same 0.96 red, the same bytes.
assert.deepEqual(result.canvasPixel, [250, 0, 0, 255]);
assert.deepEqual(result.targetPixel, result.canvasPixel, 'the comparison target sees the same');
// The blended quad, half blue over the glass, drawn after it by the owner: blue and red share
// the pixel, and green is absent.
assert.equal(result.blendedPixel[1], 0);
assert.ok(result.blendedPixel[0] > 90 && result.blendedPixel[0] < 160, 'half the red remains');
assert.ok(result.blendedPixel[2] > 90, 'half the blue is added');
assert.equal(result.copyDraws, 2, 'the glass and the blended quad are two owned submissions');
assert.ok(result.clusterDraws > 0);
assert.equal(result.targetCopyDraws, 2);
assert.equal(result.backdropBytes, 64 * 64 * 12);
assert.equal(result.drawCalls, 4, 'the backdrop pass, the display pass and the two copies');
assert.equal(result.transparentMeshes, 2);
assert.equal(result.meshesInHostPass, 0, 'a scene copy entered the host scene');
assert.ok(result.hostCalls > 0);
assert.deepEqual(
  result.wireframe,
  { copyDraws: 2, drawCalls: 3 },
  'the painted copies are drawn as whole meshes, without a backdrop pass',
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
