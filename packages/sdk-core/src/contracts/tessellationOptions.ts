import {
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  positiveSetting as positive,
  contextReader,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * THE RUN-TIME TESSELLATION OF DISPLACED SURFACES
 * (`packages/sdk-browser/src/visibility/tessellation/`): a material that names a displacement map
 * and switches its tessellation on (`./materialAbi.ts`, `DISPLACEMENT_EXTRA`) has each triangle of
 * its clusters cut into micro-triangles about `tessellationDicingRate` pixels across, each corner
 * pushed along the surface normal by what the map reads there, in the frame being drawn: the
 * detail follows the pixels, no triangle of it is stored. A triangle too large for one pattern is
 * split first, level after level, in queues of patches. Run-time settings, as `./settingRules.ts`
 * says: no compiler job names them and no cache key holds them. A scene whose materials name no
 * displacement allocates, binds and draws nothing for any of them.
 */

/** The patches a queue may hold at most: the 16 bytes a patch takes, addressed in 32 bits. */
const PATCH_ENTRIES: readonly [number, number] = [1, 134217727]
/** The patches a queue holds when none is named: 2 Mi, the reference's own. */
const DEFAULT_PATCHES = 2_097_152

/**
 * The tessellation's settings by field, each with the reference's default:
 * - `tessellation` (on): whether a displaced material is tessellated at all; off, every one draws
 *   as the flat surface its triangles describe, and nothing of the tessellation runs;
 * - `tessellationDicingRate` (2): the size, in pixels, of the micro-triangles a triangle is diced
 *   to — a finite number above zero; a smaller one cuts finer and costs more;
 * - `tessellationMaxPatchesPerGroup` (5): the patches one group of the dicing pass takes at most,
 *   a whole number of at least 1, held to what a group's threads hold at three a patch;
 * - `tessellationMaxCandidatePatches` (2 Mi) and `tessellationMaxVisiblePatches` (2 Mi): the
 *   patches the splitting queue and the visible list hold at most, each a whole number from 1; a
 *   patch past either is lost for the image;
 * - `tessellationShadowsDirectional` (on) and `tessellationShadowsLocal` (on): whether the
 *   displaced surfaces cast their displaced shape into the shadow maps of the suns and of the local
 *   lights; off, the casters of that kind of light keep the flat shape their triangles describe.
 */
export const TESSELLATION_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('tessellation', true),
    positive('tessellationDicingRate', 2, 'a finite number of pixels above zero'),
    count('tessellationMaxPatchesPerGroup', 5, 1),
    integer('tessellationMaxCandidatePatches', DEFAULT_PATCHES, PATCH_ENTRIES),
    integer('tessellationMaxVisiblePatches', DEFAULT_PATCHES, PATCH_ENTRIES),
    flag('tessellationShadowsDirectional', true),
    flag('tessellationShadowsLocal', true),
  ] as const))()
/** The tessellation setting `field` of a runtime's context (`contextReader`): its default where the
 *  context holds none. */
export const readTessellationSetting = /* @__PURE__ */ contextReader(TESSELLATION_RULES)
/** The field of one tessellation setting. */
export type TessellationField = keyof typeof TESSELLATION_RULES
/** The tessellation's settings as a host writes them: each its value, or nothing for its default. */
export type TessellationOptions = SettingOptions<typeof TESSELLATION_RULES>
/** The tessellation's settings as the engine reads them: every field set. */
export type TessellationValues = SettingValues<typeof TESSELLATION_RULES>
