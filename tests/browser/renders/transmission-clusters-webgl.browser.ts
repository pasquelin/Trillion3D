// Standalone WebGL2 proof that a transmissive scene copy composes over the autonomous cluster
// image: opaque and blended clusters show through, a cluster in front hides the glass, and every
// unsupported physical extension is refused before a draw.
//
//   node --experimental-strip-types tests/browser/renders/transmission-clusters-webgl.browser.ts
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
  withoutGlass: number;
  submissions: { clusters: number; backdrop: number; copies: number };
  opaquePixel: number[];
  throughGlass: number[];
  encoded: number[];
  restored: { framebuffer: unknown; viewport: number[]; backdropBytes: number };
  backgroundThrough: number[];
  occluded: number[];
  blendedThrough: number[];
  attenuated: number[];
  lit: number[];
  subViewport: { inside: number[]; outside: number[] };
  offscreen: { clusters: number; backdrop: number; copies: number; pixel: number[] };
  refused: Refusal;
  refusedPixel: number[];
  drawError: number;
}

const result = (await preuveDansLaPage(
  'webglClusterTransmissionPage.ts',
  'webglClusterTransmissionProof',
  'Autonomous transmission over clusters',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
const near = (actual: number[], expected: number[], tolerance = 3) =>
  actual.every((channel, i) => Math.abs(channel - expected[i]) <= tolerance);
assert.equal(result.withoutGlass, 1);
assert.deepEqual(
  result.submissions,
  { clusters: 1, backdrop: 1, copies: 1 },
  'the batch to the display, the batch into the backdrop, the glass',
);
assert.deepEqual(result.opaquePixel, [255, 0, 0, 255]);
// Normal incidence on IOR 1.5: Fresnel 0.04, so 96 % of the red cluster comes through.
assert.ok(near(result.throughGlass, [245, 0, 0, 255]), JSON.stringify(result.throughGlass));
assert.ok(near(result.encoded, [250, 0, 0, 255]), JSON.stringify(result.encoded));
assert.equal(result.restored.framebuffer, null, 'the frame target is bound again');
assert.deepEqual(result.restored.viewport, [0, 0, 32, 32]);
assert.equal(result.restored.backdropBytes, 32 * 32 * 12);
assert.ok(
  near(result.backgroundThrough, [0, 0, 245, 255]),
  JSON.stringify(result.backgroundThrough),
);
assert.deepEqual(result.occluded, [255, 255, 0, 255], 'a cluster in front hides the glass');
assert.ok(
  near(result.blendedThrough, [122, 0, 122, 255], 4),
  JSON.stringify(result.blendedThrough),
);
// Linear attenuation colour 0.5 over one unit of thickness halves what comes through.
assert.ok(near(result.attenuated, [122, 0, 0, 255], 4), JSON.stringify(result.attenuated));
assert.ok(
  result.lit[1] > 0 && result.lit[1] < 255 && result.lit[1] === result.lit[2],
  `the declared light reflects a white specular lobe on the glass: ${result.lit}`,
);
assert.ok(near(result.subViewport.inside, [245, 0, 0, 255]), JSON.stringify(result.subViewport));
assert.deepEqual(result.subViewport.outside, [0, 0, 255, 255]);
assert.deepEqual(result.offscreen, {
  clusters: 1,
  backdrop: 0,
  copies: 0,
  pixel: [255, 0, 0, 255],
});
assert.deepEqual(result.refused, {
  code: 'CLUSTER_MATERIAL_UNSUPPORTED',
  reason: 'physical clearcoat is unsupported',
});
assert.deepEqual(result.refusedPixel, [0, 0, 255, 255], 'refused before any draw');
assert.equal(result.drawError, 0);
