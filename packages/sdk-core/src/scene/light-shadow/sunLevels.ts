import { dotVector3 } from '../../math/primitives/vector.ts';
import { MAX_SHADOW_SLICES, type ShadowViewpoint } from '../light/contracts.ts';
import { faceFrame } from './math.ts';
import {
  SUN_LEVELS,
  SUN_LEVEL_ENTRIES,
  SUN_WINDOW,
  finestSunLevel,
  ringOf,
  sunPageMetres,
} from './virtual.ts';

/** Frames of layout kept to read a request report back: deeper than any readback lag. */
const HISTORY = 8;
const LEVEL_WORDS = SUN_LEVELS * 2;

/**
 * THE CLIPMAP OF EACH SUN: its light-plane frame, the depth range its maps span, its finest
 * level and the extent of every level around the camera.
 *
 * The frame is `faceFrame` of the propagation direction — the one a face is composed with — so a
 * page's world square is `[ax, ax+1) · S` along `right` and `[ay, ay+1) · S` down `up`. The depth
 * range is the scene's box along the axis, snapped outward to a grid of its own power-of-two
 * size: every caster lies inside, and a small growth of the scene changes nothing. The finest
 * level is the near-plane footprint's (`finestSunLevel`); each level's extent is centred on the
 * camera, by whole pages.
 *
 * The layout of the last `HISTORY` frames is kept: a request report comes back frames later,
 * and its words are read with the extents of the frame that wrote them.
 */
export function createSunLevels() {
  const frame = new Float64Array(MAX_SHADOW_SLICES * 9),
    depth = new Float64Array(MAX_SHADOW_SLICES * 2),
    finest = new Int32Array(MAX_SHADOW_SLICES),
    origins = new Int32Array(MAX_SHADOW_SLICES * LEVEL_WORDS),
    /** Clipmap slots whose extent moved at the last update, one bit per slot. */
    moved = new Int32Array(MAX_SHADOW_SLICES);
  const pastFrame = new Int32Array(MAX_SHADOW_SLICES * HISTORY).fill(-1),
    pastFinest = new Int32Array(MAX_SHADOW_SLICES * HISTORY),
    pastOrigins = new Int32Array(MAX_SHADOW_SLICES * HISTORY * LEVEL_WORDS);
  const right = new Float64Array(3),
    up = new Float64Array(3);
  /** Level held in slot `slot` while the finest level is `low`. */
  const levelIn = (low: number, slot: number) => low + ringOf(slot - low, SUN_LEVELS);
  return {
    frame,
    depth,
    finest,
    origins,
    /** Whether the extent of `level` moved at the last update: only its pages may have left. */
    movedLevel: (slice: number, level: number) =>
      ((moved[slice] >> ringOf(level, SUN_LEVELS)) & 1) !== 0,
    /**
     * This frame's clipmap of the sun in `slice`. Returns true when its frame or depth range
     * changed — every map it drew describes another projection.
     */
    update(
      slice: number,
      axis: ArrayLike<number>,
      view: ShadowViewpoint,
      boxMin: ArrayLike<number>,
      boxMax: ArrayLike<number>,
      frameIndex: number,
    ) {
      faceFrame(axis, right, up);
      const f = slice * 9;
      let changed = false;
      for (let a = 0; a < 3; a++) {
        if (frame[f + a] !== right[a] || frame[f + 3 + a] !== up[a] || frame[f + 6 + a] !== axis[a])
          changed = true;
        frame[f + a] = right[a];
        frame[f + 3 + a] = up[a];
        frame[f + 6 + a] = axis[a];
      }
      let low = Infinity,
        high = -Infinity;
      for (let corner = 0; corner < 8; corner++) {
        const z =
          axis[0] * (corner & 1 ? boxMax[0] : boxMin[0]) +
          axis[1] * (corner & 2 ? boxMax[1] : boxMin[1]) +
          axis[2] * (corner & 4 ? boxMax[2] : boxMin[2]);
        low = Math.min(low, z);
        high = Math.max(high, z);
      }
      if (Number.isFinite(low) && Number.isFinite(high)) {
        const grid = 2 ** Math.ceil(Math.log2(Math.max(high - low, 1e-6)));
        const zNear = Math.floor(low / grid) * grid,
          zFar = Math.max(zNear + grid, Math.ceil(high / grid) * grid);
        if (depth[slice * 2] !== zNear || depth[slice * 2 + 1] !== zFar) changed = true;
        depth[slice * 2] = zNear;
        depth[slice * 2 + 1] = zFar;
      }
      const lowest = finestSunLevel(view.pixelNear);
      let slots = changed || lowest !== finest[slice] ? (1 << SUN_LEVELS) - 1 : 0;
      finest[slice] = lowest;
      const u = dotVector3(view.position, right),
        v = dotVector3(view.position, up);
      for (let level = lowest; level < lowest + SUN_LEVELS; level++) {
        const page = sunPageMetres(level),
          at = slice * LEVEL_WORDS + ringOf(level, SUN_LEVELS) * 2;
        const ox = Math.floor(u / page) - SUN_WINDOW / 2,
          oy = Math.floor(-v / page) - SUN_WINDOW / 2;
        if (origins[at] !== ox || origins[at + 1] !== oy) slots |= 1 << ringOf(level, SUN_LEVELS);
        origins[at] = ox;
        origins[at + 1] = oy;
      }
      moved[slice] = slots;
      const past = slice * HISTORY + (frameIndex % HISTORY);
      pastFrame[past] = frameIndex;
      pastFinest[past] = lowest;
      pastOrigins.set(
        origins.subarray(slice * LEVEL_WORDS, (slice + 1) * LEVEL_WORDS),
        past * LEVEL_WORDS,
      );
      return changed;
    },
    /** True when page `(level, ax, ay)` lies in this frame's clipmap of `slice`. */
    holds(slice: number, level: number, ax: number, ay: number) {
      const lowest = finest[slice];
      if (level < lowest || level >= lowest + SUN_LEVELS) return false;
      const at = slice * LEVEL_WORDS + ringOf(level, SUN_LEVELS) * 2;
      return (
        ax - origins[at] >= 0 &&
        ax - origins[at] < SUN_WINDOW &&
        ay - origins[at + 1] >= 0 &&
        ay - origins[at + 1] < SUN_WINDOW
      );
    },
    /**
     * Level and absolute page of a sun entry, relative to the light's base, as the frame
     * `frameIndex` laid them out: written into `out` (`level, ax, ay`). False when that frame's
     * layout is no longer kept.
     */
    decode(slice: number, relative: number, frameIndex: number, out: Int32Array) {
      const past = slice * HISTORY + (frameIndex % HISTORY);
      if (pastFrame[past] !== frameIndex) return false;
      const slot = Math.floor(relative / SUN_LEVEL_ENTRIES),
        rest = relative - slot * SUN_LEVEL_ENTRIES,
        at = past * LEVEL_WORDS + slot * 2;
      const ox = pastOrigins[at],
        oy = pastOrigins[at + 1];
      out[0] = levelIn(pastFinest[past], slot);
      out[1] = ox + ringOf((rest % SUN_WINDOW) - ox, SUN_WINDOW);
      out[2] = oy + ringOf(Math.floor(rest / SUN_WINDOW) - oy, SUN_WINDOW);
      return true;
    },
    release(slice: number) {
      frame.fill(0, slice * 9, slice * 9 + 9);
      pastFrame.fill(-1, slice * HISTORY, (slice + 1) * HISTORY);
    },
  };
}

export type SunLevels = ReturnType<typeof createSunLevels>;
