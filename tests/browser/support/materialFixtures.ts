// The material fixtures of the witness comparison, one per feature the engine claims: base
// colour, its map, alpha MASK at its cutoff, BLEND, emissive, metal-roughness, normal map and
// double-sided. Each fixture is a square facing the camera, its material, where it is read and
// how far the two images may differ there — and why.
//
// This module is SERVED to the harness page and imported by its URL: the materials are built
// in the page, with the `three` of its import map, the one the SDK under `dist/` also loads.
import * as THREE from 'three';
import { VIEWPORT } from './preuveSceneCommune.ts';
import type { SceneLight } from '../../../packages/sdk-core/index.ts';

/** Side of the square viewport every fixture is rendered in, in pixels: `rgbAt` reads both
 * images with this row stride, so a viewport that is not square would misread them silently. */
export const [SIZE] = VIEWPORT;
if (VIEWPORT[1] !== SIZE)
  throw new Error(`material fixtures need a square viewport, got ${VIEWPORT}`);

/** The one declared light of the lit fixtures: a sun above and in front of the square. */
export const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [-0.3, -0.5, -0.8],
  color: [1, 1, 1],
  intensity: 2.5,
  castsShadow: false,
};

/** Two engines that quantise the same value: at most one 8-bit step apart, per channel. */
const QUANTISATION = { difference: [0, 1], reason: 'same value, two 8-bit roundings' };

/** Points inside the square, away from its edges: the centre and the four quadrant centres. */
const CENTRE = [SIZE >> 1, SIZE >> 1];
const QUADRANTS = [
  [SIZE * 0.32, SIZE * 0.32],
  [SIZE * 0.68, SIZE * 0.32],
  [SIZE * 0.32, SIZE * 0.68],
  [SIZE * 0.68, SIZE * 0.68],
].map((p) => p.map(Math.round));
const INSIDE = [CENTRE, ...QUADRANTS];

/** A 2×2 image whose texels colour the four quadrants of the square: top-left, top-right,
 *  bottom-left, bottom-right on screen (`flipY` off, plane UVs). */
function quadrantImage(texels: [number, number, number, number][]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  const at = [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0],
  ];
  texels.forEach(([r, g, b, a], i) => {
    ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
    ctx.fillRect(at[i][0], at[i][1], 1, 1);
  });
  return canvas;
}

/** A texture the two engines read the same way: nearest, unrepeated, in the declared space. */
function texture(
  texels: [number, number, number, number][],
  colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(quadrantImage(texels));
  map.colorSpace = colorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.flipY = false;
  return map;
}

/** A base-colour map of four quadrants, in sRGB like every base colour. */
const colourMap = (texels: [number, number, number, number][]) =>
  texture(texels, THREE.SRGBColorSpace);

/** A constant tangent-space normal, tilted toward +x, +y: a flat square that shades as a slope. */
const TILTED_NORMAL: [number, number, number, number][] = Array.from({ length: 4 }, () => [
  160, 210, 230, 255,
]);

export interface Fixture {
  name: string;
  material: () => THREE.Material;
  lit?: boolean;
  points: number[][];
  difference: number[];
  reason: string;
  holds?: boolean;
  back?: boolean;
  behind?: number;
  tangents?: boolean;
}

/** An unlit fixture: a basic material, read within one level unless `extra` says otherwise. */
const unlit = (
  name: string,
  params: () => THREE.MeshBasicMaterialParameters,
  extra: Partial<Fixture> = {},
): Fixture => ({
  name,
  material: () => new THREE.MeshBasicMaterial(params()),
  points: INSIDE,
  ...QUANTISATION,
  ...extra,
});

/** A lit fixture: a standard material under the sun, read within one level. */
const lit = (
  name: string,
  params: () => THREE.MeshStandardMaterialParameters,
  extra: Partial<Fixture> = {},
): Fixture => ({
  name,
  material: () => new THREE.MeshStandardMaterial(params()),
  lit: true,
  points: INSIDE,
  ...QUANTISATION,
  ...extra,
});

/** The blended square: pure red at half opacity, whatever it is composed over. */
const BLEND = (): THREE.MeshBasicMaterialParameters => ({
  color: 0xff2020,
  transparent: true,
  opacity: 0.5,
});

/**
 * Each fixture: `material()` builds it in the page; `lit` declares the sun on both sides;
 * `back` turns the square away from the camera; `behind` puts an opaque square of that colour
 * behind it; `holds: false` excuses the engine from publishing a held frame; `points` are read
 * on both images, and the largest channel gap at each must fall within `difference`, for the
 * `reason` given.
 */
export const fixtures: Fixture[] = [
  unlit('base colour', () => ({ color: 0x993322 })),
  unlit(
    'base colour map',
    () => ({
      map: colourMap([
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
      ]),
    }),
    { points: QUADRANTS },
  ),
  // The two 8-bit alphas on either side of the cutoff: 128/255 is kept, 127/255 is cut. Read at
  // the quadrant centres, far from the edge where keep and discard meet.
  unlit(
    'alpha mask at cutoff',
    () => ({
      map: colourMap([
        [255, 255, 255, 128],
        [255, 255, 255, 127],
        [255, 255, 255, 127],
        [255, 255, 255, 128],
      ]),
      alphaTest: 0.5,
    }),
    { points: QUADRANTS },
  ),
  // The engine composes a blend surface over the display background in display space, as the
  // witness does: the two agree to the level. A scene made only of blend clusters publishes no
  // held frame — without an opaque row the partition never runs, and the occluder history it
  // would establish stays missing (#198) — but the image is still after the first frames.
  unlit('blend over the background', BLEND, { holds: false }),
  // Between two drawn surfaces the engine blends in linear radiance and encodes at composition
  // (`docs/SDK.md` § Separated surfaces and lighting); the witness blends the encoded output.
  // On this pair — red at half opacity over blue — the two spaces are 45 levels apart, and that
  // gap is what is held: a display-space blend, an opaque or a fully transparent square, or
  // another opacity, all leave the window.
  unlit('blend over an opaque surface', BLEND, {
    behind: 0x2244aa,
    difference: [44, 46],
    reason: 'linear blend before the display encode, display-space blend in the witness',
  }),
  unlit('double-sided back face', () => ({ color: 0x2299cc, side: THREE.DoubleSide }), {
    back: true,
  }),
  unlit('single-sided back face', () => ({ color: 0x2299cc }), { back: true }),
  lit(
    'double-sided back face, lit',
    () => ({ color: 0x2299cc, roughness: 1, side: THREE.DoubleSide }),
    { back: true },
  ),
  lit('rough dielectric', () => ({ color: 0x808080, roughness: 1, metalness: 0 })),
  lit('polished metal', () => ({ color: 0xc0a060, roughness: 0.3, metalness: 1 })),
  lit('emissive', () => ({ color: 0x111111, roughness: 1, emissive: 0x881100 })),
  lit(
    'normal map',
    () => ({ color: 0x808080, roughness: 0.8, normalMap: texture(TILTED_NORMAL) }),
    { tangents: true },
  ),
];
