// The material fixtures of the witness comparison, one per feature the engine claims: base
// colour, its map, alpha MASK at its cutoff, BLEND, emissive, metal-roughness, normal map and
// double-sided. Each fixture is a square facing the camera, its material, where it is read and
// how far the two images may differ there — and why.
//
// This module is SERVED to the harness page and imported by its URL: the materials are built
// in the page, with the `three` of its import map, the one the SDK under `dist/` also loads.
import * as THREE from 'three';

/** Viewport of every fixture, in pixels: a square, so one camera serves them all. */
export const SIZE = 96;

/** Background the harness page and the engines clear to, so an uncovered pixel is one colour. */
export const CLEAR_COLOR = 0x2a303c;

/** The one declared light of the lit fixtures: a sun above and in front of the square. */
export const SUN = {
  id: 'sun',
  kind: 'directional',
  direction: [-0.3, -0.5, -0.8],
  color: [1, 1, 1],
  intensity: 2.5,
  castsShadow: false,
};

/** Tolerance of two engines that quantise the same 8-bit value: one step per channel. */
const QUANTISATION = { tolerance: 1, reason: 'same value, two 8-bit roundings' };

/** Points inside the square, away from its edges: the centre and the four quadrant centres. */
const CENTRE = [SIZE >> 1, SIZE >> 1];
const QUADRANTS = [
  [SIZE * 0.32, SIZE * 0.32],
  [SIZE * 0.68, SIZE * 0.32],
  [SIZE * 0.32, SIZE * 0.68],
  [SIZE * 0.68, SIZE * 0.68],
].map((p) => p.map(Math.round));
const INSIDE = [CENTRE, ...QUADRANTS];

/** A 2×2 image whose texels, bottom-left first, colour the four quadrants of the square. */
function quadrantImage(texels) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d');
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
function texture(image, colorSpace = THREE.NoColorSpace) {
  const map = new THREE.CanvasTexture(image);
  map.colorSpace = colorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.flipY = false;
  map.needsUpdate = true;
  return map;
}

/** A base-colour map of four quadrants, in sRGB like every base colour. */
const quadrantMap = (texels) => texture(quadrantImage(texels), THREE.SRGBColorSpace);

/** A constant tangent-space normal, tilted toward +x, +y: a flat square that shades as a slope. */
function tiltedNormalImage() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(160,210,230)';
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}

/** An unlit fixture: a basic material, read within one level unless `extra` says otherwise. */
const unlit = (name, params, extra = {}) => ({
  name,
  material: () => new THREE.MeshBasicMaterial(params()),
  points: INSIDE,
  ...QUANTISATION,
  ...extra,
});

/** A lit fixture: a standard material under the sun, read within one level. */
const lit = (name, params, extra = {}) => ({
  name,
  material: () => new THREE.MeshStandardMaterial(params()),
  lit: true,
  points: INSIDE,
  ...QUANTISATION,
  ...extra,
});

/** The blended square: pure red at half opacity, whatever it is composed over. */
const BLEND = () => ({ color: 0xff2020, transparent: true, opacity: 0.5 });

/**
 * Each fixture: `material()` builds it in the page; `lit` declares the sun on both sides;
 * `back` turns the square away from the camera; `behind` puts an opaque square of that colour
 * behind it; `holds: false` excuses the engine from publishing a held frame; `points` are read
 * on both images and must agree within `tolerance` per channel, for the `reason` given.
 */
export const fixtures = [
  unlit('base colour', () => ({ color: 0x993322 })),
  unlit(
    'base colour map',
    () => ({
      map: quadrantMap([
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
      map: quadrantMap([
        [255, 255, 255, 128],
        [255, 255, 255, 127],
        [255, 255, 255, 127],
        [255, 255, 255, 128],
      ]),
      alphaTest: 0.5,
    }),
    { points: QUADRANTS },
  ),
  // A scene made only of blend clusters publishes no held frame: without an opaque row the
  // partition never runs, and the occluder history it would establish stays missing (#198).
  // The image is nonetheless still after the first frames, and is read there.
  unlit('blend over the background', BLEND, { holds: false }),
  // Declared in `docs/SDK.md` § Separated surfaces and lighting: the engine blends in linear
  // radiance and encodes at composition, the witness blends the encoded output. On this pair —
  // red at half opacity over blue — the two spaces are 45 levels apart (measured, 20 Sept.
  // 2026); an opaque or fully transparent square lies more than twice as far.
  unlit('blend over an opaque surface', BLEND, {
    behind: 0x2244aa,
    tolerance: 46,
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
    () => ({ color: 0x808080, roughness: 0.8, normalMap: texture(tiltedNormalImage()) }),
    { tangents: true },
  ),
];
