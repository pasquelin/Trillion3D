// The sizes a sun's entries and the first pool derive from (`virtual.ts` re-exports the shared ones).
import { LIGHT_SETTINGS } from '../light/contracts.ts';

/** Side of a shadow page, in texels: the unit of the pool, of the virtual maps and of invalidation. */
export const SHADOW_PAGE: number = LIGHT_SETTINGS.shadowPage;

export const SUN_LEVELS: number = LIGHT_SETTINGS.sunLevels;

/** Pages a side of a sun's `2W × 2H` texel rectangle: one per `P / 2` screen pixels. */
export const tiles = (pixels: number) => Math.ceil((2 * Math.max(1, pixels)) / SHADOW_PAGE);

/** The pool the first frame asks for `lights` shadowed lights, each read over the whole smooth
 *  `w × h` screen — its texel rectangle, and a third more while pages wait —, twice: the report
 *  the pool holds and the next one, which a turn of the camera may renew in full. */
export const priorPoolPages = (w: number, h: number, lights: number) =>
  2 * lights * Math.ceil((4 * tiles(w) * tiles(h)) / 3);

/** The extent is a session's, not the module's: a reference session raises it so every pixel of a
 *  wide view reads the finest clipmap level (`referenceMode.ts`), an ordinary one keeps the
 *  constant. Every size an extent implies is a function of its pages, the constant the default. */
export const sunLevelEntries = (pages: number) => pages * pages;

export const sunEntries = (pages: number) => SUN_LEVELS * sunLevelEntries(pages);
