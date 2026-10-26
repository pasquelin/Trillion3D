import { LOCAL_FOG_MOST_VOLUMES } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'

/**
 * THE LOCAL FOG VOLUMES' BLOCK OF THE LIGHT BUFFER (`DirectLights.localFog`, `vec4f` slots): what every
 * program that lays the fog over a point — the opaque lit passes, the translucent layers, the sky, the
 * clouds — and the volume's cells read of the local fog volumes of the view, at no binding of their
 * own. The CPU writes it each image from the view (`localPlan.ts`, `../../frame/render/localFogView.ts`):
 * the header, the sun, the view, and the volumes of the view in the order they are drawn, each over the
 * one before it; the GPU writes the sky light's term (`localSkyWgsl.ts`). The lists of the volumes over
 * each tile of the screen are not here: the culling pass writes them (`localCullWgsl.ts`) into a buffer
 * of their own, made for the tile grid, which the programs that read them bind (`fogTilesWgsl`,
 * `localWgsl.ts`).
 *
 * - the header: how many volumes the view draws, the switches (`LOCAL_FOG_FLAG`), the most extinction a
 *   volume gives a cell of the fog's volume, per metre, the distance, metres, before which no volume
 *   shows;
 * - the sun: its light — colour times illuminance, through the air toward it where it is the air's — and
 *   the unit direction toward it;
 * - the view: the four rows of its view-projection relative to the eye — the plane of a point's screen
 *   position, depth and weight, which the cells find their tile by —, its size in pixels, its near
 *   distance, and the tiling the volumes are culled by (`LOCAL_FOG_SLOT.tiling`), with the words the
 *   lists take: 0 across where the view is not tiled, a program then walks every volume of the view;
 * - the sky: three rows `(a, b)` such that the sky light's diffuse light along `n`, times the light's
 *   volumetric scattering intensity, is `max(0, a · n + b)` for each colour channel;
 * - the volumes: five slots each (`LOCAL_FOG_INSTANCE`).
 */

/** The bits of the header's switches. */
export const LOCAL_FOG_FLAG = {
  /** The volumes are voxelised into the fog's volume where it is built: the cells read them, and the
   *  analytic law draws only what lies past the volume's far end. */
  inVolume: 1,
  /** The translucent surfaces are fogged by the volumes too. */
  onTranslucent: 2,
} as const

/** The slots of the block. */
export const LOCAL_FOG_SLOT = {
  /** `count, flags, maxVolumeDensity, startDistance`. */
  header: 0,
  /** The sun's light, its lane 3 1 where the view has a sun. */
  sunLight: 1,
  /** The unit direction toward the sun. */
  sunDirection: 2,
  /** The rows `x`, `y`, `z` and `w` of the view-projection, for a point relative to the eye (four slots):
   *  the three lanes of the row that multiply the point, then what it adds. */
  projection: 3,
  /** `width, height` of the view in pixels, its near distance, the words the tiles' lists take. */
  screen: 7,
  /** `size, across, down, stride`: the tile's side in pixels, the tiles across the view and down it, the
   *  words of a tile's list; `across` 0 where the view is not tiled (no volume this image, or the culling
   *  pass is not ready). */
  tiling: 8,
  /** The sky light's three rows. */
  sky: 9,
  /** The first volume. */
  instances: 12,
} as const

/** The slots of a volume, from its first. The law of a volume — its density by the distance to its
 *  centre and by the height along its axis — turns about that axis unchanged, so a volume is a centre
 *  and a radius, its height axis, and its numbers; the rest of its rotation is not kept:
 *  - `centre`: where its centre lies relative to the eye, metres, and its radius;
 *  - `axis`: the unit vector of its height in the world, and its start distance, metres;
 *  - `law`: the radial extinction, the height extinction, the height's falloff in the volume's own
 *    units and its offset;
 *  - `albedo`: the share of the light each channel scatters, and the phase function's distribution;
 *  - `emissive`: the light it gives off. */
export const LOCAL_FOG_INSTANCE = {
  centre: 0,
  axis: 1,
  law: 2,
  albedo: 3,
  emissive: 4,
  /** Slots a volume takes. */
  slots: 5,
} as const

/** Slots of the block, room for the most volumes a view draws. */
export const LOCAL_FOG_SLOTS =
  LOCAL_FOG_SLOT.instances + LOCAL_FOG_MOST_VOLUMES * LOCAL_FOG_INSTANCE.slots
/** Floats of the block. */
export const LOCAL_FOG_FLOATS = LOCAL_FOG_SLOTS * 4
