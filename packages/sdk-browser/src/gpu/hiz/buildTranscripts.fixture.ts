import { encodeHizPyramid } from './pyramid.ts';
import {
  HIZ_BUILD_SIDE as S,
  HIZ_PASS_LEVELS,
  hizBuildPasses,
  hizBuildWords,
  pyramidBytes,
} from './uniforms.ts';

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
  const { sizes, offsets, texels: words } = pyramidBytes(scene.width, scene.height);
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

/** One `buildHiz` workgroup: S × S lanes, the barriers as phases, stale workgroup memory kept. */
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
  const far = new Float32Array(S * S);
  for (let lane = 0; lane < S * S; lane++) {
    const x = wg[0] * S + (lane % S),
      y = wg[1] * S + Math.floor(lane / S),
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
  for (let k = 1, side = S >> 1; k < HIZ_PASS_LEVELS; k++, side >>= 1) {
    const [, w, h] = dst(k - 1),
      [offset, dstW, dstH] = dst(k);
    const live: number[] = [];
    for (let lane = 0; lane < S * S; lane++) {
      const lx = lane % S,
        ly = Math.floor(lane / S),
        tx = wg[0] * side + lx,
        ty = wg[1] * side + ly;
      if (!(k < d && lx < side && ly < side && tx < dstW && ty < dstH)) continue;
      const at = ly * 2 * S + lx * 2;
      let v = tile[at];
      if (tx * 2 + 1 < w) v = Math.min(v, tile[at + 1]);
      if (ty * 2 + 1 < h) {
        v = Math.min(v, tile[at + S]);
        if (tx * 2 + 1 < w) v = Math.min(v, tile[at + S + 1]);
      }
      far[lane] = v;
      live.push(lane);
    }
    // workgroupBarrier(): every read of the level is done before any lane overwrites the tile.
    for (const lane of live) {
      const tx = wg[0] * side + (lane % S),
        ty = wg[1] * side + Math.floor(lane / S);
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
  // The grid and the uniform slot of each dispatch are the ones the host encodes.
  let slot = 0;
  const grids: number[][] = [];
  const pass = {
    setPipeline() {},
    setBindGroup: (_: number, __: unknown, offsets: number[]) => (slot = offsets[0] / 4),
    dispatchWorkgroups: (...grid: number[]) => grids.push([slot, ...grid]),
    end() {},
  };
  const encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder;
  const group = {} as GPUBindGroup,
    pipeline = {} as GPUComputePipeline;
  encodeHizPyramid(encoder, '', group, pipeline, sizes, passes, SLOT_WORDS * 4, count);
  for (const [at, gx, gy, gz] of grids) {
    const u = words.subarray(at, at + SLOT_WORDS);
    for (let z = 0; z < gz; z++)
      for (let y = 0; y < gy; y++)
        for (let x = 0; x < gx; x++) {
          // Whatever workgroup memory holds: an exact kernel never reads a texel it did not write.
          const tile = Float32Array.from({ length: S * S }, () => rand() * 1e9 - 5e8);
          workgroup(scene, u, pyramid, [x, y, z], tile);
        }
  }
}
