// First part of the foundation bench, `sdk-core` consumers: each computation attached to
// the foundation, opposed to the code it was before, copied in `oracles/socle-math*.ts`.
// A single different value and the line fails: the attachment changes no bit.
import { cross } from '../../../sdk-core/lightingSceneMath.ts';
import { packSurface } from '../../../sdk-core/lightingTransportIntersections.ts';
import { fillPatchRays } from '../../../sdk-core/lightingTransportRays.ts';
import {
  composeFace,
  shadowOrthographic,
  shadowProjection,
} from '../../../sdk-core/sceneLightShadowMath.ts';
import { writeConeVolume } from '../../../sdk-core/sceneLightShadowVolume.ts';
import type { Scene, Surface, Vec3 } from '../../../sdk-core/lightingExperimentScene.ts';
import type { Mesure } from '../../../sdk-core/bench/socle.ts';
import * as ancien from '../oracles/socle-math.ts';
import * as ombres from '../oracles/socle-math-ombres.ts';
import { points } from './scenesSocle.ts';
import { directions, facettes, rectangles } from './scenesSocleConsommateurs.ts';
import { essaie, ligne } from './socleLigne.ts';

/** The previous raise, written as `essaie` writes today's. */
const leve = (v: unknown) => (v === 'INVALID_SCENE' ? 'raise: INVALID_SCENE' : v);

/** One hostile eye/direction/region case, as `scenesSocleConsommateurs.ts` builds it. */
interface DirectionCase {
  perspective: boolean;
  fov: number;
  portee: number;
  demiEtendue: number;
  oeil: number[];
  before: number[];
  demiChamp: number;
  rect: Float64Array;
}

/** A shadow face on both sides: composed matrix then cone of its region, perspective or not. */
function faceNouvelle(c: DirectionCase): [Float32Array, Float32Array] {
  const matrice = new Float32Array(20),
    cull = new Float32Array(8);
  const plans = c.perspective
    ? shadowProjection(c.fov, c.portee)
    : shadowOrthographic(c.demiEtendue, c.portee);
  composeFace(matrice, 4, c.oeil as Vec3, c.before as Vec3);
  writeConeVolume(cull, 0, c.oeil, plans.far, c.demiChamp, c.rect);
  return [matrice, cull.slice(4)];
}
function faceAncienne(c: DirectionCase): [Float32Array, Float32Array] {
  const matrice = new Float32Array(20),
    proj = new Float32Array(16);
  if (c.perspective) ombres.referenceShadowProjection(proj, c.fov, c.portee);
  else ombres.referenceShadowOrthographic(proj, c.demiEtendue, c.portee);
  ombres.referenceComposeFace(matrice, 4, c.oeil, c.before, proj);
  const cone =
    c.demiChamp >= Math.PI / 2
      ? [...ombres.referenceFaceBasis.slice(6), Math.PI]
      : ombres.referenceConeAxisCosine(c.rect, c.demiChamp);
  return [matrice, Float32Array.from(cone)];
}

export async function lignesConsommateursCore(): Promise<Mesure[]> {
  return [
    await ligne(
      'shadow faces: view, product and cone',
      'packages/sdk-core/sceneLightShadowMath.ts',
      'hostile eyes, directions and regions',
      directions as DirectionCase[],
      (l) => l.map(faceAncienne),
      (l) => l.map(faceNouvelle),
    ),
    await ligne(
      'cross product of the lighting scene',
      'packages/sdk-core/lightingSceneMath.ts',
      'hostile vectors',
      points as Vec3[],
      (l) => l.map((p, i) => ancien.referenceCross(p, l[(i * 7 + 1) % l.length])),
      (l) => l.map((p, i) => cross(p, l[(i * 7 + 1) % l.length])),
    ),
    await ligne(
      'packed transport surface',
      'packages/sdk-core/lightingTransportIntersections.ts',
      'hostile rectangles',
      // Each fixture only carries the geometry `packSurface` reads (origin, u, v): the rest of
      // `Surface` is irrelevant to this measurement.
      rectangles as Surface[],
      (l) => l.map((s) => leve(ancien.referencePackedSurface(s))),
      (l) =>
        l.map((s) =>
          essaie(() => {
            const out = new Float64Array(15);
            packSurface(s, out, 0);
            return out;
          }),
        ),
    ),
    await ligne(
      'rays of one transport facet',
      'packages/sdk-core/lightingTransportRays.ts',
      'hostile facets',
      // Same reduced fixture: only `patches[0]` (id, normal, u) is read.
      facettes as Scene[],
      (l) =>
        l.map((scene) => leve(ancien.referenceFillPatchRays(scene, 0, 16, new Float64Array(96)))),
      (l) =>
        l.map((scene) =>
          essaie(() => {
            const rays = new Float64Array(96);
            fillPatchRays(scene, 0, 16, rays);
            return rays;
          }),
        ),
    ),
  ];
}
