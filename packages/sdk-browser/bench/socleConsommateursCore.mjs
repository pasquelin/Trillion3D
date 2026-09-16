// Première partie du banc du socle, consommateurs de `sdk-core` : chaque calcul rattaché au socle
// opposé au code qu'il était avant, recopié dans `oracles/socle-math*.mjs`. Une seule valeur
// différente et la ligne tombe : le rattachement ne change aucun bit.
import { cross } from '../../sdk-core/lightingSceneMath.ts';
import { packSurface } from '../../sdk-core/lightingTransportIntersections.ts';
import { fillPatchRays } from '../../sdk-core/lightingTransportRays.ts';
import {
  composeFace,
  shadowOrthographic,
  shadowProjection,
} from '../../sdk-core/sceneLightShadowMath.ts';
import { writeConeVolume } from '../../sdk-core/sceneLightShadowVolume.ts';
import * as ancien from './oracles/socle-math.mjs';
import * as ombres from './oracles/socle-math-ombres.mjs';
import { points } from './scenesSocle.mjs';
import { directions, facettes, rectangles } from './scenesSocleConsommateurs.mjs';
import { essaie, ligne } from './socleLigne.mjs';

/** La levée d'avant, écrite comme `essaie` écrit celle d'aujourd'hui. */
const leve = (v) => (v === 'INVALID_SCENE' ? 'levée : INVALID_SCENE' : v);

/** Une face d'ombre des deux côtés : matrice composée puis cône de sa région, perspective ou non. */
function faceNouvelle(c) {
  const matrice = new Float32Array(20),
    cull = new Float32Array(8);
  const plans = c.perspective
    ? shadowProjection(c.fov, c.portee)
    : shadowOrthographic(c.demiEtendue, c.portee);
  composeFace(matrice, 4, c.oeil, c.avant);
  writeConeVolume(cull, 0, c.oeil, plans.far, c.demiChamp, c.rect);
  return [matrice, cull.slice(4)];
}
function faceAncienne(c) {
  const matrice = new Float32Array(20),
    proj = new Float32Array(16);
  if (c.perspective) ombres.referenceShadowProjection(proj, c.fov, c.portee);
  else ombres.referenceShadowOrthographic(proj, c.demiEtendue, c.portee);
  ombres.referenceComposeFace(matrice, 4, c.oeil, c.avant, proj);
  const cone =
    c.demiChamp >= Math.PI / 2
      ? [...ombres.referenceFaceBasis.slice(6), Math.PI]
      : ombres.referenceConeAxisCosine(c.rect, c.demiChamp);
  return [matrice, Float32Array.from(cone)];
}

export async function lignesConsommateursCore() {
  return [
    await ligne(
      'faces d’ombre : vue, produit et cône',
      'packages/sdk-core/sceneLightShadowMath.ts',
      'yeux, directions et régions hostiles',
      directions,
      (l) => l.map(faceAncienne),
      (l) => l.map(faceNouvelle),
    ),
    await ligne(
      'produit vectoriel de la scène d’éclairage',
      'packages/sdk-core/lightingSceneMath.ts',
      'vecteurs hostiles',
      points,
      (l) => l.map((p, i) => ancien.referenceCross(p, l[(i * 7 + 1) % l.length])),
      (l) => l.map((p, i) => cross(p, l[(i * 7 + 1) % l.length])),
    ),
    await ligne(
      'surface empaquetée du transport',
      'packages/sdk-core/lightingTransportIntersections.ts',
      'rectangles hostiles',
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
      'rayons d’une facette du transport',
      'packages/sdk-core/lightingTransportRays.ts',
      'facettes hostiles',
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
