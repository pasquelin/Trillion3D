// Real-browser proof that the cluster renderer draws its own program into the host canvas and
// respects an sRGB framebuffer's scissor instead of replacing the remaining host pass.
//
//   node --experimental-strip-types test/browser/rendu-clusters-webgl.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../appui/preuvePageMoteur.ts';

interface StatistiqueEcart {
  rms: number;
  max: number;
}

interface Resultat extends ResultatPagePreuve {
  canvasCenter: number[];
  mirroredFront: number[];
  fboInside: number[];
  fboOutside: number[];
  opaqueAlpha: number;
  maskAlpha: number;
  framebufferStatus: number;
  drawError: number;
  ambient: number[];
  direct: number[];
  zeroPenumbraSpot: number[];
  translatedDirect: number[];
  directWitness: number[];
  neutralNormal: number[];
  invisibleSubmissions: number;
  rejected: boolean;
  textures: {
    linearMap: number[];
    basicAo: number[];
    linearEmissive: number[];
    uv1Transform: number[];
  };
  normalFrames: {
    tilted: number[];
    tiltedWitness: number[];
    mirrored: number[];
    mirroredWitness: number[];
  };
  decayRejected: boolean;
  heldRestore: { draws: number; restoredPixel: number[] };
  curved: { rawNonBlack: number }[];
  curvedMotion: { rawCenter: number[]; referenceCenter: number[] }[];
  curvedOracle: {
    spatial: { owned: StatistiqueEcart; witness: StatistiqueEcart };
    temporal: { owned: StatistiqueEcart; witness: StatistiqueEcart };
  };
  winding: {
    modelMirror: { owned: unknown; witness: unknown };
    cameraMirror: { owned: unknown; witness: unknown };
  };
}

const result = (await preuveDansLaPage(
  'webglClusterRendererPage.ts',
  'webglClusterRendererProof',
  'Autonomous WebGL2 cluster renderer',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.deepEqual(result.canvasCenter, [118, 0, 0, 255]);
assert.deepEqual(result.mirroredFront, result.canvasCenter);
assert.deepEqual(result.fboInside, [118, 0, 0, 255]);
assert.deepEqual(result.fboOutside, [0, 0, 255, 255]);
assert.equal(result.opaqueAlpha, 255);
assert.equal(result.maskAlpha, 255);
assert.equal(result.framebufferStatus, 36053);
assert.equal(result.drawError, 0);
assert.deepEqual(result.ambient, [118, 0, 0, 255]);
assert.deepEqual(result.direct, [70, 10, 10, 255]);
assert.ok(result.zeroPenumbraSpot[0] > 0);
assert.deepEqual(result.translatedDirect, result.direct);
assert.ok(result.directWitness[0] > 0);
assert.deepEqual(result.neutralNormal, result.direct);
assert.equal(result.invisibleSubmissions, 0);
assert.equal(result.rejected, true);
assert.deepEqual(result.textures, {
  linearMap: [118, 118, 118, 255],
  basicAo: [118, 118, 118, 255],
  linearEmissive: [118, 118, 118, 255],
  uv1Transform: [255, 255, 0, 255],
});
// The tangent is rebuilt from the triangle (no attribute): a tilted normal map shades as the
// same tilt baked into the vertex normals, within one 8-bit level, and a mirrored v flips the
// tilt's y (the frame's handedness), so the two mapped pixels differ.
const withinOneLevel = (a: number[], b: number[]) =>
  a.every((value, i) => Math.abs(value - b[i]) <= 1);
assert.ok(withinOneLevel(result.normalFrames.tilted, result.normalFrames.tiltedWitness));
assert.ok(withinOneLevel(result.normalFrames.mirrored, result.normalFrames.mirroredWitness));
assert.notDeepEqual(result.normalFrames.tilted, result.normalFrames.mirrored);
assert.equal(result.decayRejected, true);
assert.deepEqual(result.heldRestore, { draws: 2, restoredPixel: [0, 255, 0, 255] });
assert.ok(result.curved.every((entry) => entry.rawNonBlack > 500));
const span = (values: number[]) => Math.max(...values) - Math.min(...values);
const rawMotion = result.curvedMotion.map((frame) => frame.rawCenter[0]);
const referenceMotion = result.curvedMotion.map((frame) => frame.referenceCenter[0]);
assert.ok(span(rawMotion) <= span(referenceMotion));
assert.ok(result.curvedOracle.spatial.owned.rms <= result.curvedOracle.spatial.witness.rms);
assert.ok(result.curvedOracle.spatial.owned.max <= result.curvedOracle.spatial.witness.max);
assert.ok(result.curvedOracle.temporal.owned.rms <= result.curvedOracle.temporal.witness.rms);
assert.ok(result.curvedOracle.temporal.owned.max <= result.curvedOracle.temporal.witness.max);
assert.deepEqual(result.winding.modelMirror.owned, result.winding.modelMirror.witness);
assert.deepEqual(result.winding.cameraMirror.owned, result.winding.cameraMirror.witness);
