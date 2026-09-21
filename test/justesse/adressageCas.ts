// Defect 4: texel addressing cases and the Three rule they are compared to.
//
// Three does not pick the texel itself: it hands the map's wrap mode to the GPU sampler
// (`WebGLTextures`: RepeatWrapping → REPEAT, MirroredRepeatWrapping → MIRRORED_REPEAT,
// ClampToEdgeWrapping → CLAMP_TO_EDGE). The reference is therefore the full OpenGL ES 3.0
// specification rule (§ 3.8.10), the same as WebGPU: i = ⌊u·size⌋, then clamp, modulo, or
// modulo over two periods whose second is read backwards. The GPU script checks that
// reference against the real samplers, case by case.
import * as THREE from 'three';

export const MODES: [string, THREE.Wrapping][] = [
  ['ClampToEdge', THREE.ClampToEdgeWrapping],
  ['Repeat', THREE.RepeatWrapping],
  ['MirroredRepeat', THREE.MirroredRepeatWrapping],
];

/**
 * WebGPU address mode of each Three wrap mode, the one `WebGLTextures` gives the sampler:
 * the table of every addressing GPU bench, written once.
 */
export const ADRESSE = new Map<THREE.Wrapping, GPUAddressMode>([
  [THREE.ClampToEdgeWrapping, 'clamp-to-edge'],
  [THREE.RepeatWrapping, 'repeat'],
  [THREE.MirroredRepeatWrapping, 'mirror-repeat'],
]);

/** Modes exercised on the GPU: readable name, Three wrap mode, WebGPU address mode. */
export const MODES_GPU = MODES.map(([nom, wrap]) => ({ nom, wrap, adresse: ADRESSE.get(wrap) }));

/** Half a level in 255: the weight quantisation the sampler is allowed. */
export const TOLERANCE = 0.5;

/** Texel index `i` brought back into the image by the address mode alone, without its coordinate. */
function enroule(i: number, taille: number, wrap: THREE.Wrapping) {
  if (wrap === THREE.ClampToEdgeWrapping) return Math.min(taille - 1, Math.max(0, i));
  const periode = wrap === THREE.RepeatWrapping ? taille : 2 * taille;
  const j = ((i % periode) + periode) % periode;
  return j < taille ? j : periode - 1 - j;
}

/** The texel nearest-neighbour sampling keeps on an axis of `taille` texels. */
export function texelThree(t: number, taille: number, wrap: THREE.Wrapping) {
  return enroule(Math.floor(t * taille), taille, wrap);
}

/**
 * The two texels linear filtering blends on an axis, and the weight of the second: the
 * coordinate shifted by half a texel gives the low index, and each of the two indices takes
 * the address mode for itself (§ 3.8.10). Under `Repeat`, the two indices of a period seam
 * are therefore the last texel and the first, which wrapping the coordinate would split.
 */
export function lineaireThree(
  t: number,
  taille: number,
  wrap: THREE.Wrapping,
): [number, number, number] {
  const c = t * taille - 0.5,
    bas = Math.floor(c);
  return [enroule(bas, taille, wrap), enroule(bas + 1, taille, wrap), c - bas];
}

/** The byte the two blended texels yield on their axis: red = 20 + 40x, green = 20 + 40y. */
export const melange = ([i0, i1, poids]: [number, number, number]) =>
  (20 + 40 * i0) * (1 - poids) + (20 + 40 * i1) * poids;

/** The rule's exact colour on an axis, the two texels blended, brought back to [0, 1]. */
export const regleNormalisee = (t: number, taille: number, wrap: THREE.Wrapping) =>
  melange(lineaireThree(t, taille, wrap)) / 255;

/**
 * A period seam: under `Repeat`, the two blended texels are not neighbours in the image,
 * one is the last and the other the first. Clamp and mirror read the same edge texel twice
 * there, which wrapping the coordinate already yields — they have no seam.
 */
export const surCouture = (t: number, taille: number, wrap: THREE.Wrapping) => {
  if (wrap !== THREE.RepeatWrapping) return false;
  const [i0, i1] = lineaireThree(t, taille, wrap);
  return i1 !== i0 + 1;
};

/** True when the coordinate falls, to 1e-3 texel, on the boundary of two texels. */
export const surFrontiere = (t: number, taille: number) =>
  Math.abs(t * taille - Math.round(t * taille)) < 1e-3;

/**
 * Coordinates of an axis of `taille` texels, rounded to 32-bit float as the GPU receives
 * them: integers, texel centres (half-texel), boundaries, negatives, neighbours of 0 and 1,
 * and large (±1e3) on both period parities.
 */
export function coordonnees(taille: number) {
  const out = [-1001, -1000, -3, -2, -1, 0, 1, 2, 3, 1000, 1001, 0.999, -0.001, 1.001, -0.999];
  for (const p of [-3, -2, -1, 0, 1, 2])
    for (let k = 0; k < taille; k++) out.push(p + (k + 0.5) / taille);
  for (const p of [-2, -1, 0, 1]) for (let k = 1; k < taille; k++) out.push(p + k / taille);
  for (const p of [-1001, -1000, 1000, 1001])
    for (let k = 0; k < taille; k++) out.push(p + (k + 0.5) / taille);
  return out.map(Math.fround);
}

/** The other axis, fixed off-boundary at 1.3: the three modes read three different texels there. */
export const AUTRE_AXE = Math.fround(1.3);

/**
 * Test textures, one even size and one odd on each axis. Texel (x, y): red 20 + 40x, green
 * 20 + 40y, alpha 10 + 10·index — every component distinct.
 */
export const TAILLES: [number, number][] = [
  [4, 5],
  [5, 4],
];
export function octetsTexture(largeur: number, hauteur: number) {
  const data = new Uint8Array(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const o = (y * largeur + x) * 4;
      data.set([20 + 40 * x, 20 + 40 * y, 0, 10 + 10 * (y * largeur + x)], o);
    }
  return data;
}

/** One addressing case: a coordinate on the exercised axis, the other fixed, and Three's texel. */
export interface AdressageCas {
  largeur: number;
  hauteur: number;
  axe: 'u' | 'v';
  nomS: string;
  nomT: string;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
  u: number;
  v: number;
  eprouve: string;
  frontiere: boolean;
  couture: boolean;
  attendu: [number, number];
  /** Rank within the case list, written by the CPU probe to index its own texel readings. */
  rang?: number;
}

/**
 * Every case: each size, each exercised axis, each pair of modes (S, T). The exercised
 * coordinate walks `coordonnees`, the other is `AUTRE_AXE`. `attendu` is Three's texel (x, y).
 */
export function cas(): AdressageCas[] {
  const out: AdressageCas[] = [];
  for (const [largeur, hauteur] of TAILLES)
    for (const axe of ['u', 'v'] as const) {
      const taille = axe === 'u' ? largeur : hauteur;
      for (const [nomS, wrapS] of MODES)
        for (const [nomT, wrapT] of MODES)
          for (const t of coordonnees(taille)) {
            const u = axe === 'u' ? t : AUTRE_AXE,
              v = axe === 'v' ? t : AUTRE_AXE;
            const eprouve = axe === 'u' ? nomS : nomT;
            out.push({
              largeur,
              hauteur,
              axe,
              nomS,
              nomT,
              wrapS,
              wrapT,
              u,
              v,
              eprouve,
              frontiere: surFrontiere(t, taille),
              couture: surCouture(t, taille, axe === 'u' ? wrapS : wrapT),
              attendu: [texelThree(u, largeur, wrapS), texelThree(v, hauteur, wrapT)],
            });
          }
    }
  return out;
}

// `bilan` and `somme`, the discrepancy tallies shared by the addressing probes, live in
// `adressageBilan.ts`: this file keeps only the case model and the addressing rule.
