import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { forEachShadowFace } from './sceneLightShadowCasters.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';

type Slices = ReturnType<typeof createShadowSliceTable>;

/** Angular radius of the influence sphere over the half-field: named approximation (P5). */
export function screenCoverage(
  view: ShadowViewpoint,
  x: number,
  y: number,
  z: number,
  range: number,
) {
  const dx = x - view.position[0],
    dy = y - view.position[1],
    dz = z - view.position[2];
  const distance = Math.hypot(dx, dy, dz);
  const ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2];
  if (ahead + range < 0 || distance - range > view.far) return 0;
  const ratio = Math.atan(range / Math.max(distance, 1e-3)) / view.halfFovY;
  return Math.min(1, ratio * ratio);
}

/**
 * What the shadow pass actually did: pages, never durations. Pages invalidated by
 * the frame, pages redrawn, pages left waiting, and the lag of the oldest of
 * them — in milliseconds and in frames. Everything is allocated once.
 */
export function createShadowCounts() {
  const drewAt = new Int32Array(LIGHT_SETTINGS.maxLights);
  let denied = 0,
    reused = 0,
    lights = 0,
    sunLights = 0,
    invalidatedPages = 0,
    pendingPages = 0,
    waitedMs = 0,
    waitedFrames = 0;
  /** What a frame resets; `reset` adds what survives from one frame to the next. */
  const beginFrame = () => {
    denied = 0;
    reused = 0;
    lights = 0;
    sunLights = 0;
    invalidatedPages = 0;
  };
  return {
    get denied() {
      return denied;
    },
    get reused() {
      return reused;
    },
    /** Lights of which at least one region was redrawn by this frame. */
    get lights() {
      return lights;
    },
    get sunLights() {
      return sunLights;
    },
    get invalidatedPages() {
      return invalidatedPages;
    },
    get pendingPages() {
      return pendingPages;
    },
    /** Lag of the page that has been waiting the longest, in milliseconds and in frames. */
    get waitedMs() {
      return waitedMs;
    },
    get waitedFrames() {
      return waitedFrames;
    },
    beginFrame,
    deny() {
      denied++;
    },
    reusedLight() {
      reused++;
    },
    /** A region has just been kept for this light: it counts only once per frame. */
    drewLight(slot: number, store: SceneLightStore, frame: number) {
      if (drewAt[slot] === frame + 1) return;
      drewAt[slot] = frame + 1;
      lights++;
      const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
      if (store.packed[base + LIGHT_FIELD.kind] === LIGHT_KIND.directional) sunLights++;
    },
    /**
     * What remains after admission: pages that entered the queue this frame — counted at entry,
     * never deduced from a difference —, those that stay there, and the lag of the oldest.
     * A single scan of the faces that declared shadow lights own.
     */
    endFrame(slices: Slices, store: SceneLightStore, frame: number, nowMs: number) {
      invalidatedPages = slices.dirty.invalidated;
      pendingPages = 0;
      waitedMs = 0;
      waitedFrames = 0;
      forEachShadowFace(store, (_slot, slice, face) => {
        if (!slices.dirty.isDirty(slice, face)) return;
        pendingPages += slices.dirty.pages(slice, face);
        waitedMs = Math.max(waitedMs, slices.dirty.waitedMs(slice, face, nowMs));
        waitedFrames = Math.max(waitedFrames, slices.dirty.waitedFrames(slice, face, frame));
      });
    },
    reset() {
      beginFrame();
      pendingPages = 0;
      waitedMs = 0;
      waitedFrames = 0;
      drewAt.fill(0);
    },
  };
}
