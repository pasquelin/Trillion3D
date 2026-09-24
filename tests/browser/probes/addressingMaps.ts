// Defect 8: the material whose six maps do not share the same wrap mode, and the addressing each
// map's header carries. The GPU bench and the non-regression test both read
// this fixture: one material exercised, hence one thing to reread when the modes change.
import { importHostTexture } from '../../../packages/sdk-browser/src/host/surfaceImport.ts';
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { octetsTexture } from './addressingCases.ts';
import {
  SAMPLE_WRAP_SHIFT,
  samplingWords,
} from '../../../packages/sdk-browser/src/webgpu/tile/sampling.ts';

const {
  ClampToEdgeWrapping: SERRE,
  RepeatWrapping: REPETE,
  MirroredRepeatWrapping: MIROIR,
} = THREE;

/** The six texture slots a `MeshStandardMaterial` carries. */
type MapChamp = 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'aoMap' | 'emissiveMap';

/**
 * One map per material slot, each on a different pair of modes: no mode is shared by two
 * neighbouring maps, so a nibble applied to the wrong map is seen at once.
 */
export const CARTES: {
  nom: string;
  champ: MapChamp;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
}[] = [
  { nom: 'base', champ: 'map', wrapS: REPETE, wrapT: REPETE },
  { nom: 'roughness', champ: 'roughnessMap', wrapS: SERRE, wrapT: MIROIR },
  { nom: 'metal', champ: 'metalnessMap', wrapS: MIROIR, wrapT: SERRE },
  { nom: 'normales', champ: 'normalMap', wrapS: SERRE, wrapT: SERRE },
  { nom: 'occlusion', champ: 'aoMap', wrapS: MIROIR, wrapT: MIROIR },
  { nom: 'emissive', champ: 'emissiveMap', wrapS: REPETE, wrapT: SERRE },
];

/** The exercised image: 4×5 distinct texels, that of the wrap benches of batches 4 and 7. */
export const TEXTURE = { largeur: 4, hauteur: 5, octets: Array.from(octetsTexture(4, 5)) };

/**
 * Coordinates where the three modes part: integers, negatives, large values, and the half-texel
 * of both edges of a period, the seam batch 7 learned to wrap. The fixed axis lands at a texel
 * centre, off the border, so only the exercised coordinate decides.
 */
const AXE = [-1001, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625, 0, 0.02, 0.999, 2.98].map(
  Math.fround,
);
export const UV = AXE.flatMap((t) => [
  [t, Math.fround(0.3)],
  [Math.fround(0.375), t],
  [t, t],
]);

/** The six-map material, each in its mode, with no image: only the modes are read here. */
export function materielMelange() {
  const mat = G.standardSurface({ alphaTest: 0.5 });
  for (const { champ, wrapS, wrapT } of CARTES)
    mat[champ] = Object.assign(new G.GraphTexture(), { wrapS, wrapT });
  return mat;
}

/** The addressing nibble each map's header carries (`samplingWords`), in `CARTES` order: what the
 *  shader folds that map's coordinate by. */
export function nibblesDuMelange() {
  const mat = materielMelange();
  return CARTES.map(
    ({ champ }) =>
      (samplingWords(importHostTexture(mat[champ] as G.GraphTexture), false)[0] >>> SAMPLE_WRAP_SHIFT) & 15,
  );
}
