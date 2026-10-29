import {
  atLeast,
  countSetting,
  flagSetting,
  integerSetting,
  nonNegativeSetting,
  numberSetting,
  positiveSetting,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The global distance field's run-time settings, as `./settingRules.ts` says: the clipmaps that
 * composite every mesh's distance field around the viewer (`../lighting/globalDistanceField.ts`),
 * read by the distance-field occlusion of the sky light and by the volumetric fog's sky visibility,
 * and the atlas the meshes' fields are streamed into (`packages/sdk-browser/src/lighting/distanceField/`).
 * Each is the reference's console variable of that name, with its default; lengths are in the
 * reference's unit, the centimetre, as the sky light's settings are.
 *
 * The clipmaps:
 * - `globalDistanceField` (true): whether the clipmaps are made at all;
 * - `globalDistanceFieldUpdate` (true): whether they are updated; false keeps what they hold;
 * - `globalDistanceFieldClipmaps` (4): how many clipmaps, at most 6;
 * - `globalDistanceFieldViewDistance` (20000): the world's view distance of the field, the
 *   outermost clipmap's extent being it over `globalDistanceFieldClipmapExponent` squared times
 *   (the world setting of the reference, `GlobalDistanceFieldViewDistance`);
 * - `globalDistanceFieldClipmapExponent` (2): the factor between one clipmap's extent and the next;
 * - `globalDistanceFieldResolution` (128): the voxels along a clipmap, rounded up to a whole
 *   number of 4 pages of 7;
 * - `globalDistanceFieldMipFactor` (4): the divider of a clipmap's coarse mip, 1 to 8;
 * - `globalDistanceFieldOccupancyRatio` (0.3): the share of its pages the page atlas expects
 *   filled, 0.1 to 1;
 * - `globalDistanceFieldCacheMostlyStaticSeparately` (true): whether the static meshes composite
 *   into a clipmap of their own, so that a moving mesh recomposites the movable ones alone;
 * - `globalDistanceFieldPartialUpdates` (true): whether a clipmap updates only the pages that moved
 *   or changed;
 * - `globalDistanceFieldStaggeredUpdates` (true): whether the larger clipmaps update less often;
 * - `globalDistanceFieldUpdatesPerFrame` (2): how many clipmaps update each frame, at least 1;
 * - `globalDistanceFieldForceFullUpdate` (false): whether every clipmap is composited whole on
 *   every frame; `globalDistanceFieldForceUpdateOnce` (false): one such frame each time it turns on;
 * - `globalDistanceFieldFastCameraMode` (false): whether the field follows a fast camera, at lower
 *   quality: the clipmaps are centred ahead of the camera by its velocity, one more clipmap is
 *   made, one is updated each frame and the smallest meshes it holds are ten times larger;
 *   `globalDistanceFieldCameraVelocityDecay` (0.7) is the share of that offset kept after a second;
 * - `globalDistanceFieldAverageCulledObjectsPerCell` (512): the objects a cell of the culling grid
 *   is expected to hold, 1 to 8192, which sizes its list;
 * - `globalDistanceFieldRecacheOnStreaming` (true): whether a clipmap composited while a mesh it
 *   holds had only its coarsest mip is composited again when the streaming is done;
 *   `globalDistanceFieldForceRecacheOnStreaming` (false): whether each such update is always whole;
 * - `globalDistanceFieldStartDistance` (100): the distance along an occlusion cone from which the
 *   global field replaces the meshes' own (`r.AOGlobalDFStartDistance`);
 * - `globalDistanceFieldMinMeshRadius` (20) and `globalDistanceFieldMinMeshRadiusInVoxels` (0.5):
 *   a mesh whose bounding sphere is smaller than the larger of the two is left out of the field.
 *
 * The rays marched through the field (the reflections' scene stage, `../lighting/globalDistanceField.ts`):
 * - `globalDistanceFieldTraceResolution` (252) and `globalDistanceFieldTraceClipmapExtent` (2500):
 *   while a ray is marched through the field, the voxels along a clipmap and the half-extent of the
 *   first clipmap, each next twice the one before, take these in place of `globalDistanceFieldResolution`,
 *   `globalDistanceFieldViewDistance` and `globalDistanceFieldClipmapExponent`;
 * - `globalDistanceFieldTraceViewDistance` (20000): the distance the scene is kept to while rays are
 *   marched through the field; the clipmaps are `globalDistanceFieldClipmaps` and one more where the
 *   extent of the clipmap after them reaches it, two more where the extent of the second after them does;
 * - `globalDistanceFieldCoveredExpandSurfaceScale` (1) and
 *   `globalDistanceFieldNotCoveredExpandSurfaceScale` (0.6): the scale of the half voxel by which a
 *   marched ray expands the surface it meets, to close surfaces thinner than the gap between two
 *   voxels, in the pages the meshes cover and in those only two-sided meshes reach;
 * - `globalDistanceFieldSimpleCoverageBasedExpand` (false): whether a page only two-sided meshes reach
 *   counts as wholly not covered; false reads the coverage atlas, a coverage for each voxel, where
 *   the ray is in such a page;
 * - `globalDistanceFieldNotCoveredMinStepScale` (4): the scale of the least step of a marched ray in
 *   the pages only two-sided meshes reach;
 * - `globalDistanceFieldDitheredTransparencyStepThreshold` (0.5) and
 *   `globalDistanceFieldDitheredTransparencyTraceThreshold` (0.9): for a ray that is dithered, the
 *   noise under which a surface of the pages only two-sided meshes reach stops it, at each step and
 *   along the whole ray.
 *
 * The meshes' fields, streamed into one brick atlas, the coarsest mip of each always loaded:
 * - `meshDistanceFieldMaxObjectRadius` (100000): a placement whose bounding sphere is larger is left
 *   out of the scene's fields;
 * - `meshDistanceFieldSurfaceBiasExpand` (0.25): the share of a voxel a surface is expanded by
 *   when a distance is taken;
 * - `meshDistanceFieldBrickAtlasSize` (128): the bricks along the two first axes of the atlas, a
 *   power of two (another is taken down to one), which grows in the third; read when the atlas is made;
 * - `meshDistanceFieldBrickAtlasDepth` (32): the bricks the atlas grows to along the third axis
 *   before it drops the finer mips (32 is 256 MiB); the coarsest mips are kept past it;
 * - `meshDistanceFieldUploadKiB` (8192): the data of the finer mips uploaded to the atlas each frame;
 * - `meshDistanceFieldBlockBricks` (16): the bricks an allocation of the atlas holds, a divider of
 *   the atlas's first axis; read when the atlas is made;
 * - `meshDistanceFieldForceMips` (0): 1 to 3 loads that many mips of every mesh whatever the view
 *   (the atlas's space still limits them); 0 follows the view;
 * - `meshDistanceFieldReverseAllocation` (false): whether the mips added in a frame take the atlas's
 *   space in the reverse order;
 * - `runtimeMeshDistanceFields` (false): whether a mesh made at run time, which no compiler gave a
 *   field, gets one built where it is made, on the page's device, by the compiler's own program
 *   (`../lighting/distanceFieldGpu.ts`); the reference builds fields at import only and has no
 *   such mesh, so this is ours and off until a scene asks for it.
 */
export const GLOBAL_DISTANCE_FIELD_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flagSetting('globalDistanceField', true),
    flagSetting('globalDistanceFieldUpdate', true),
    integerSetting('globalDistanceFieldClipmaps', 4, [0, 6]),
    positiveSetting('globalDistanceFieldViewDistance', 20000),
    numberSetting('globalDistanceFieldClipmapExponent', 2, atLeast(1)),
    countSetting('globalDistanceFieldResolution', 128, 1),
    integerSetting('globalDistanceFieldMipFactor', 4, [1, 8]),
    numberSetting('globalDistanceFieldOccupancyRatio', 0.3, [0.1, 1]),
    flagSetting('globalDistanceFieldCacheMostlyStaticSeparately', true),
    flagSetting('globalDistanceFieldPartialUpdates', true),
    flagSetting('globalDistanceFieldStaggeredUpdates', true),
    countSetting('globalDistanceFieldUpdatesPerFrame', 2, 1),
    flagSetting('globalDistanceFieldForceFullUpdate', false),
    flagSetting('globalDistanceFieldForceUpdateOnce', false),
    flagSetting('globalDistanceFieldFastCameraMode', false),
    nonNegativeSetting('globalDistanceFieldCameraVelocityDecay', 0.7),
    integerSetting('globalDistanceFieldAverageCulledObjectsPerCell', 512, [1, 8192]),
    flagSetting('globalDistanceFieldRecacheOnStreaming', true),
    flagSetting('globalDistanceFieldForceRecacheOnStreaming', false),
    nonNegativeSetting('globalDistanceFieldStartDistance', 100),
    nonNegativeSetting('globalDistanceFieldMinMeshRadius', 20),
    nonNegativeSetting('globalDistanceFieldMinMeshRadiusInVoxels', 0.5),
    countSetting('globalDistanceFieldTraceResolution', 252, 1),
    positiveSetting('globalDistanceFieldTraceClipmapExtent', 2500),
    positiveSetting('globalDistanceFieldTraceViewDistance', 20000),
    nonNegativeSetting('globalDistanceFieldCoveredExpandSurfaceScale', 1),
    nonNegativeSetting('globalDistanceFieldNotCoveredExpandSurfaceScale', 0.6),
    flagSetting('globalDistanceFieldSimpleCoverageBasedExpand', false),
    nonNegativeSetting('globalDistanceFieldNotCoveredMinStepScale', 4),
    nonNegativeSetting('globalDistanceFieldDitheredTransparencyStepThreshold', 0.5),
    nonNegativeSetting('globalDistanceFieldDitheredTransparencyTraceThreshold', 0.9),
    nonNegativeSetting('meshDistanceFieldMaxObjectRadius', 100000),
    nonNegativeSetting('meshDistanceFieldSurfaceBiasExpand', 0.25),
    countSetting('meshDistanceFieldBrickAtlasSize', 128, 1),
    countSetting('meshDistanceFieldBrickAtlasDepth', 32, 1),
    countSetting('meshDistanceFieldUploadKiB', 8192, 1),
    countSetting('meshDistanceFieldBlockBricks', 16, 1),
    integerSetting('meshDistanceFieldForceMips', 0, [0, 3]),
    flagSetting('meshDistanceFieldReverseAllocation', false),
    flagSetting('runtimeMeshDistanceFields', false),
  ] as const))()

/** The field of one setting of the global distance field. */
export type GlobalDistanceFieldField = keyof typeof GLOBAL_DISTANCE_FIELD_RULES

/** What a host writes for the global distance field: any of its fields. */
export type GlobalDistanceFieldOptions = SettingOptions<typeof GLOBAL_DISTANCE_FIELD_RULES>

/** The global distance field's settings as resolved. */
export type GlobalDistanceFieldSettings = SettingValues<typeof GLOBAL_DISTANCE_FIELD_RULES>
