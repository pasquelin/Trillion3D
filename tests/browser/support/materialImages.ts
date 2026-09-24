// The images of the material fixtures (`materialFixtures.ts`), drawn in the page on a canvas and
// handed to both engines as the same host texture.
//
// This module is SERVED to the harness page and imported by its URL, like the fixtures.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';

/** How a map is read beyond its pixels: the host texture's fields, written over the canvas one. */
type MapOptions = Partial<
  Pick<
    G.GraphTexture,
    'colorSpace' | 'magFilter' | 'minFilter' | 'generateMipmaps' | 'wrapS' | 'wrapT' | 'anisotropy'
  >
> & { repeat?: number };

/** A `size`² canvas `draw` paints, as a host texture both engines read the same way: unflipped,
 *  with `options` over the host's defaults. */
export function canvasMap(
  size: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  { repeat, ...options }: MapOptions = {},
): G.GraphTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!);
  const map = Object.assign(G.canvasTexture(canvas), options, { flipY: false });
  if (repeat) map.repeat.set(repeat, repeat);
  return map;
}

/** Nearest both ways and no chain: every read returns one texel. */
const NEAREST = {
  magFilter: G.HOST_FILTER_NEAREST,
  minFilter: G.HOST_FILTER_NEAREST,
  generateMipmaps: false,
} as const;

/** Quadrant texels, top-left, top-right, bottom-left, bottom-right on screen (`flipY` off, plane
 *  UVs), by their place in a 2×2 image. */
const QUADRANT_AT = [
  [0, 1],
  [1, 1],
  [0, 0],
  [1, 0],
];

/** A texture the two engines read the same way: a 2×2 image whose texels colour the four
 *  quadrants of the square, nearest, unrepeated, in the declared space. */
export function texture(
  texels: [number, number, number, number][],
  colorSpace: string = G.HOST_COLOUR_SPACE_NONE,
): G.GraphTexture {
  return canvasMap(
    2,
    (ctx) =>
      texels.forEach(([r, g, b, a], i) => {
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(QUADRANT_AT[i][0], QUADRANT_AT[i][1], 1, 1);
      }),
    { colorSpace, ...NEAREST },
  );
}

/** An 8×8 black-and-white checker, nearest under magnification: a mixed read — the one sampler
 *  every map had on WebGPU before #361 — puts a fifth to a third of the neighbour texel into each point
 *  read below, a nearest read returns the texel alone. */
export const checkerMap = () =>
  canvasMap(
    8,
    (ctx) => {
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#000000';
          ctx.fillRect(x, y, 1, 1);
        }
    },
    { colorSpace: G.HOST_COLOUR_SPACE_SRGB, ...NEAREST },
  );

/** Black and white stripes one texel wide, running along V, repeated four times each way, with
 *  the host's mip chain and trilinear filters: across the stripes only U varies, so a footprint
 *  squeezed along V blurs them at the isotropic level and keeps them at the anisotropic one. */
export const stripeMap = (anisotropy: number) =>
  canvasMap(
    8,
    (ctx) => {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = x % 2 ? '#ffffff' : '#000000';
        ctx.fillRect(x, 0, 1, 8);
      }
    },
    {
      colorSpace: G.HOST_COLOUR_SPACE_SRGB,
      wrapS: G.HOST_WRAP_REPEAT,
      wrapT: G.HOST_WRAP_REPEAT,
      repeat: 4,
      anisotropy,
    },
  );

/** Foliage: green leaves two texels wide, opaque, between gaps two texels wide, transparent,
 *  running along V, repeated four times each way under the host's chain and trilinear filters —
 *  the stripes of `stripeMap` as an alpha cutout, seen at a grazing angle with `anisotropy`. */
const foliageMap = (anisotropy: number) =>
  canvasMap(
    8,
    (ctx) => {
      ctx.fillStyle = '#2e8b3a';
      for (let x = 0; x < 8; x += 4) ctx.fillRect(x, 0, 2, 8);
    },
    {
      colorSpace: G.HOST_COLOUR_SPACE_SRGB,
      wrapS: G.HOST_WRAP_REPEAT,
      wrapT: G.HOST_WRAP_REPEAT,
      repeat: 4,
      anisotropy,
    },
  );

/** Red, green, blue and yellow texels, one per quadrant of a map. */
export const FOUR_COLOURS: [number, number, number, number][] = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
];

/** A constant tangent-space normal, tilted toward +x, +y: a flat square that shades as a slope. */
export const TILTED_NORMAL: [number, number, number, number][] = Array.from({ length: 4 }, () => [
  160, 210, 230, 255,
]);

/** A base-colour map of four quadrants, in sRGB like every base colour. */
export const colourMap = (texels: [number, number, number, number][]) =>
  texture(texels, G.HOST_COLOUR_SPACE_SRGB);

/** A cutout material of `foliageMap`, anisotropy 16, cut at half alpha. */
export const foliage = () => ({ map: foliageMap(16), alphaTest: 0.5 });
