// First part of the foundation bench, `sdk-core` consumers: each computation attached to
// the foundation, opposed to the code it was before, copied in `oracles/socle-math*.mjs`.
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
import * as ancien from '../oracles/socle-math.mjs';
import * as ombres from '../oracles/socle-math-ombres.mjs';
import { points } from './scenesSocle.mjs';
import { directions, facettes, rectangles } from './scenesSocleConsommateurs.mjs';
import { essaie, ligne } from './socleLigne.mjs';

/** The previous raise, written as `essaie` writes today's. */
const leve = (v) => (v === 'INVALID_SCENE' ? 'raise: INVALID_SCENE' : v);

/** A shadow face on both sides: composed matrix then cone of its region, perspective or not. */
function faceNouvelle(c) {
  const matrice = new Float32Array(20),
    cull = new Float32Array(8);
  const plans = c.perspective
    ? shadowProjection(c.fov, c.portee)
    : shadowOrthographic(c.demiEtendue, c.portee);
  composeFace(matrice, 4, c.oeil, c.before);
  writeConeVolume(cull, 0, c.oeil, plans.far, c.demiChamp, c.rect);
  return [matrice, cull.slice(4)];
}
function faceAncienne(c) {
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

export async function lignesConsommateursCore() {
  return [
    await ligne(
      'shadow faces: view, product and cone',
      'packages/sdk-core/sceneLightShadowMath.ts',
      'hostile eyes, directions and regions',
      directions,
      (l) => l.map(faceAncienne),
      (l) => l.map(faceNouvelle),
    ),
    await ligne(
      'cross product of the lighting scene',
      'packages/sdk-core/lightingSceneMath.ts',
      'hostile vectors',
      points,
      (l) => l.map((p, i) => ancien.referenceCross(p, l[(i * 7 + 1) % l.length])),
      (l) => l.map((p, i) => cross(p, l[(i * 7 + 1) % l.length])),
    ),
    await ligne(
      'packed transport surface',
      'packages/sdk-core/lightingTransportIntersections.ts',
      'hostile rectangles',
      rectangles,
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
      facettes,
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
