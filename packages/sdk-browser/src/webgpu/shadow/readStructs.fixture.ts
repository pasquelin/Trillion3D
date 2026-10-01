import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import { SUN_LEVELS } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

type V = number[];

/** The shadow read's WGSL structs as `shaderRun` builds them: the demand's and the shading's
 *  lamp lookups (`lampReadAt`, `lampFacePoint`) return these. */
export const SHADOW_READ_STRUCTS = {
  ShadowAt: (map: object, t: V, home: V, Q: V, texel: number) => ({ map, t, home, Q, texel }),
  LampFacePoint: (clip: V, ndc: V, t: V) => ({ clip, ndc, t }),
  LampAt: (at: object, clip: V, ndc: V, face: number, side: number, inside: boolean) => ({
    ...{ at, clip, ndc },
    ...{ face, side, inside },
  }),
  ShadowMap: (base: number, ring: number, pages: number, ox: number, oy: number) => ({
    ...{ base, ring, pages },
    ...{ ox, oy },
  }),
};

/** The sun's record as the demand reads it: its frame, the window origins of its slots two by
 *  two, and its levels, finest level and first table entry. */
export function sunRecord(plan: ShadowPlan, slice: number) {
  const { frame, origins, finest } = plan.sun,
    at = slice * SUN_LEVELS * 2;
  return {
    frame: [0, 1, 2].map((row) => [
      ...frame.subarray(slice * 9 + row * 3, slice * 9 + row * 3 + 3),
    ]),
    origins: Array.from({ length: SUN_LEVELS / 2 }, (_, k) => [
      ...origins.subarray(at + k * 4, at + k * 4 + 4),
    ]),
    info: [SUN_LEVELS, finest[slice], 0, plan.table.baseOf(slice)],
  };
}
