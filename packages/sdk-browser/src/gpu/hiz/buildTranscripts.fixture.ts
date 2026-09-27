import { hizLevelSizes } from './oracle.ts';
import { HIZ_PASS_LEVELS, hizBuildPasses, hizBuildWords } from './uniforms.ts';

// The pyramid build of develop (`copyDepth`, then one `reduceHiz` per mip) and `buildHiz`,
// transcribed line by line for `buildEquivalence.test.ts`.
const SLOT_WORDS = 64;
export const LEVEL_CAP = 16;

export type Scene = {
  texture: Float32Array;
  textureWidth: number;
  width: number;
  height: number;
  maxLevels: number;
  /** One origin per pyramid, or none: the camera's single pyramid from texel zero. */
  origins?: Array<[number, number]>;
};

export function layout(scene: Scene) {
  const sizes = hizLevelSizes(scene.width, scene.height);
  const offsets: number[] = [];
  let words = 0;
  for (const [w, h] of sizes) {
    offsets.push(words);
    words += w * h;
  }
  const count = scene.origins?.length ?? 1;
  const stride = scene.origins ? words : 0;
  return { sizes, offsets, count, stride, words: words * count };
}

const origin = (scene: Scene, z: number) => (scene.origins ? scene.origins[z] : [0, 0]);
const texel = (scene: Scene, z: number, x: number, y: number) => {
  const [ox, oy] = origin(scene, z);
  return scene.texture[(oy + y) * scene.textureWidth + ox + x];
};

/** `copyDepth` then one `reduceHiz` per mip, as develop encoded them. */
export function buildBefore(scene: Scene, pyramid: Float32Array) {
  const { sizes, offsets, count, stride } = layout(scene);
  for (let z = 0; z < count; z++)
    for (let y = 0; y < scene.height; y++)
      for (let x = 0; x < scene.width; x++)
        pyramid[z * stride + y * scene.width + x] = texel(scene, z, x, y);
  for (let i = 0; i < sizes.length - 1 && i + 1 < scene.maxLevels; i++) {
    const [srcW, srcH] = sizes[i],
      [dstW, dstH] = sizes[i + 1];
    for (let z = 0; z < count; z++) {
      const src = offsets[i] + z * stride;
      for (let y = 0; y < dstH; y++)
        for (let x = 0; x < dstW; x++) {
          const x0 = x * 2,
            y0 = y * 2;
          let far = pyramid[src + y0 * srcW + x0];
          if (x0 + 1 < srcW) far = Math.min(far, pyramid[src + y0 * srcW + x0 + 1]);
          if (y0 + 1 < srcH) {
            far = Math.min(far, pyramid[src + (y0 + 1) * srcW + x0]);
            if (x0 + 1 < srcW) far = Math.min(far, pyramid[src + (y0 + 1) * srcW + x0 + 1]);
          }
          pyramid[offsets[i + 1] + z * stride + y * dstW + x] = far;
        }
    }
  }
}

/** One `buildHiz` workgroup: 64 lanes, the barriers as phases, stale workgroup memory kept. */
function workgroup(
  scene: Scene,
  u: Uint32Array,
  pyramid: Float32Array,
  wg: number[],
  tile: Float32Array,
) {
  const [a, b, c, d, e, , g] = u;
  const dst = (k: number) => u.subarray(8 + 4 * k, 12 + 4 * k);
  const z = wg[2];
  const source = (x: number, y: number) => {
    const at = a + z * g + y * b + x;
    if (e === 0) return pyramid[at];
    return (pyramid[at] = texel(scene, z, x, y));
  };
  const far = new Float32Array(64);
  for (let lane = 0; lane < 64; lane++) {
    const x = wg[0] * 8 + (lane & 7),
      y = wg[1] * 8 + (lane >> 3),
      x0 = x * 2,
      y0 = y * 2;
    far[lane] = 0;
    if (x0 < b && y0 < c) {
      far[lane] = source(x0, y0);
      if (x0 + 1 < b) far[lane] = Math.min(far[lane], source(x0 + 1, y0));
      if (y0 + 1 < c) {
        far[lane] = Math.min(far[lane], source(x0, y0 + 1));
        if (x0 + 1 < b) far[lane] = Math.min(far[lane], source(x0 + 1, y0 + 1));
      }
      if (d > 0) pyramid[dst(0)[0] + z * g + y * dst(0)[1] + x] = far[lane];
    }
    tile[lane] = far[lane];
  }
  for (let k = 1, side = 4; k < HIZ_PASS_LEVELS; k++, side >>= 1) {
    const [, w, h] = dst(k - 1),
      [offset, dstW, dstH] = dst(k);
    const live: number[] = [];
    for (let lane = 0; lane < 64; lane++) {
      const lx = lane & 7,
        ly = lane >> 3,
        tx = wg[0] * side + lx,
        ty = wg[1] * side + ly;
      if (!(k < d && lx < side && ly < side && tx < dstW && ty < dstH)) continue;
      const at = ly * 2 * 8 + lx * 2;
      let v = tile[at];
      if (tx * 2 + 1 < w) v = Math.min(v, tile[at + 1]);
      if (ty * 2 + 1 < h) {
        v = Math.min(v, tile[at + 8]);
        if (tx * 2 + 1 < w) v = Math.min(v, tile[at + 9]);
      }
      far[lane] = v;
      live.push(lane);
    }
    // workgroupBarrier(): every read of the level is done before any lane overwrites the tile.
    for (const lane of live) {
      const tx = wg[0] * side + (lane & 7),
        ty = wg[1] * side + (lane >> 3);
      tile[lane] = far[lane];
      pyramid[offset + z * g + ty * dstW + tx] = far[lane];
    }
  }
}

export function buildAfter(scene: Scene, pyramid: Float32Array, rand: () => number) {
  const { sizes, offsets, count, stride } = layout(scene);
  const passes = hizBuildPasses(sizes, scene.maxLevels);
  const words = hizBuildWords(
    new Uint32Array(LEVEL_CAP * SLOT_WORDS),
    sizes,
    offsets,
    passes,
    SLOT_WORDS * 4,
    stride,
  );
  passes.forEach(({ source }, i) => {
    const u = words.subarray(i * SLOT_WORDS, (i + 1) * SLOT_WORDS);
    const [w, h] = sizes[source];
    for (let z = 0; z < count; z++)
      for (let gy = 0; gy < Math.ceil(h / 16); gy++)
        for (let gx = 0; gx < Math.ceil(w / 16); gx++) {
          // Workgroup memory starts undefined: garbage that an exact kernel never reads.
          const tile = Float32Array.from({ length: 64 }, () => rand() * 1e9 - 5e8);
          workgroup(scene, u, pyramid, [gx, gy, z], tile);
        }
  });
}
