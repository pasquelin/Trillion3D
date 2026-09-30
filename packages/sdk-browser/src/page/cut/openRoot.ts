import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts';

/** True when a camera cut lets every node and page of a root through: a root never culled
 *  (`SPRITE_UNCULLED`). A light's cut never walks a root that casts no shadow (`castsNoShadow`).
 *  Read by the CPU cut (`select.ts`) and by the GPU cut's oracle (`dagViewFrames`). */
export const openMark = (mark: number | undefined, light: unknown) =>
  ((mark ?? 0) & SPRITE_UNCULLED) !== 0 && !light;
/** Six planes no box leaves, `(0, 0, 0, 1)` each: what an open root is walked against, by the CPU
 *  cut (`select.ts`) and the GPU cut's oracle (`dagViewFrames`). */
export const OPEN_PLANES = Float64Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 1 : 0));
