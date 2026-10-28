// The hair strands' passes' WGSL texts of `ENGINE_SHADERS`: the tangents, the bounds of the instances and of
// the macro groups, the transmittance of the ribbons and its resolve, the tiles, the raster of the visibility samples
// and the clear of them, and the compaction, each in the forms the device picks (the 64-bit maximum or two phases, two,
// four or eight samples a pixel), the visibility by the hardware raster and its resolve, the materials of the samples, the depth of the nearest strand and the patch of
// the surfaces, and the shadow maps' marking and projection over the strands.
import { GROUP_BOUNDS_WGSL, MACRO_BOUNDS_WGSL } from '../../hair/boundsWgsl.ts'
import { compactWgsl, NODE_ARGS_WGSL } from '../../hair/compactionWgsl.ts'
import { MSAA_WGSL, msaaResolveWgsl } from '../../hair/msaaWgsl.ts'
import { clearWgsl, rasterWgsl } from '../../hair/rasterWgsl.ts'
import {
  DEEP_SHADOW_ALLOCATE_WGSL,
  DEEP_SHADOW_MASK_WGSL,
  DEEP_SHADOW_RASTER_WGSL,
} from '../../hair/deepShadowWgsl.ts'
import { hairComposeWgsl } from '../../hair/compositionWgsl.ts'
import { hairEnvKernel, hairEnvSkyProgram } from '../../hair/envWgsl.ts'
import { hairSkyAoWgsl } from '../../hair/skyAoWgsl.ts'
import { hairStaticLightWgsl } from '../../hair/staticLightWgsl.ts'
import { screenStageShader } from '../../lighting/bounce/screen/stageShader.ts'
import { hairLightPassWgsl, hairSkyPassWgsl } from '../../hair/hairLightWgsl.ts'
import { HAIR_LUT_WGSL } from '../../hair/hairLutWgsl.ts'
import { HAIR_DEPTH_WGSL, hairGbufferWgsl } from '../../hair/gbufferWgsl.ts'
import { MATERIAL_WGSL, SAMPLE_COVERAGE_WGSL } from '../../hair/materialWgsl.ts'
import { FULL_CONTRACT } from '../../lighting/deferred/contractCuts.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmPixelPageMarkingWgsl } from '../../lighting/shadows/vsm/markingWgsl.ts'
import {
  vsmLocalsProjectionWgsl,
  vsmSunsProjectionWgsl,
} from '../../lighting/shadows/vsm/projection/projectionWgsl.ts'
import { TANGENT_WGSL } from '../../hair/tangentWgsl.ts'
import { MIP_ARGS_WGSL, MIP_WGSL } from '../../hair/voxelMipWgsl.ts'
import { VOXEL_INJECT_WGSL, VOXEL_RASTER_WGSL } from '../../hair/voxelRasterWgsl.ts'
import { hairSurfaceShadowWgsl } from '../../hair/surfaceShadowWgsl.ts'
import { voxelTransmittanceWgsl } from '../../hair/voxelTransmittanceWgsl.ts'
import {
  ADD_INDIRECT_WGSL,
  ADD_NODE_WGSL,
  ALLOCATE_PAGE_INDEX_WGSL,
  ALLOCATE_PAGES_WGSL,
  CLEAR_PAGES_WGSL,
  FEEDBACK_WGSL,
  MARK_VALID_WGSL,
} from '../../hair/voxelWgsl.ts'
import { ARGS_WGSL, SUBGROUP_TILES_WGSL, WORKGROUP_TILES_WGSL } from '../../hair/tilesWgsl.ts'
import {
  CLEAR_TARGETS_WGSL,
  RESOLVE_WGSL,
  TRANSMITTANCE_WGSL,
} from '../../hair/transmittanceWgsl.ts'
import { WORD_LIGHT_FORMAT } from './lightAtlasFormat.ts'

const COUNTS = [2, 4, 8] as const

/** The raster, its clear and the compaction of each sample count, with and without the 64-bit maximum. */
const perCount = () =>
  Object.fromEntries(
    COUNTS.flatMap((samples) =>
      [true, false].flatMap((wide) => {
        const form = `${samples}_${wide ? 'WIDE' : 'SPLIT'}`
        return [
          [`HAIR_RASTER_${form}`, rasterWgsl(samples, wide)],
          [`HAIR_CLEAR_SAMPLES_${form}`, clearWgsl(samples, wide)],
          [`HAIR_MSAA_RESOLVE_${form}`, msaaResolveWgsl(samples, wide)],
          [`HAIR_COMPACT_${form}`, compactWgsl(samples, wide)],
        ]
      }),
    ),
  ) as Record<string, string>

/** The shadow maps' marking and projection over the strands (input `strands`), for the layout the engine
 *  makes for one sun. */
const shadowMaps = () => {
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 })
  return {
    HAIR_VSM_MARKING: vsmPixelPageMarkingWgsl(layout, false, false, false, 'strands'),
    HAIR_VSM_MARKING_THROTTLED: vsmPixelPageMarkingWgsl(layout, false, false, true, 'strands'),
    HAIR_VSM_PROJECTION_SUNS: vsmSunsProjectionWgsl(layout, false, 'strands'),
    HAIR_VSM_PROJECTION_SUNS_SUBGROUPS: vsmSunsProjectionWgsl(layout, true, 'strands'),
    HAIR_VSM_PROJECTION_LOCALS: vsmLocalsProjectionWgsl(layout, 'rg32uint', false, 'strands'),
    HAIR_VSM_PROJECTION_LOCALS_SUBGROUPS: vsmLocalsProjectionWgsl(
      layout,
      'rg32uint',
      true,
      'strands',
    ),
  }
}

/** The environment's kernels: each integration, gathering from the radiance cache (a stage of the screen probes' pass) and from the sky light. */
const environmentKernels = () =>
  Object.fromEntries(
    (['sh', 'adhoc', 'uniform'] as const).flatMap((mode) => [
      [
        `HAIR_ENVIRONMENT_${mode.toUpperCase()}_CACHE`,
        screenStageShader(
          { side: 8, samples: [4, 4], light: WORD_LIGHT_FORMAT },
          hairEnvKernel(mode, 'cache'),
        ),
      ],
      [`HAIR_ENVIRONMENT_${mode.toUpperCase()}_SKY`, hairEnvSkyProgram(mode)],
    ]),
  ) as Record<string, string>

export const HAIR_SHADERS: Record<string, string> = {
  HAIR_TANGENTS: TANGENT_WGSL,
  HAIR_GROUP_BOUNDS: GROUP_BOUNDS_WGSL,
  HAIR_MACRO_BOUNDS: MACRO_BOUNDS_WGSL,
  HAIR_TRANSMITTANCE: TRANSMITTANCE_WGSL,
  HAIR_TRANSMITTANCE_RESOLVE: RESOLVE_WGSL,
  HAIR_CLEAR_TARGETS: CLEAR_TARGETS_WGSL,
  HAIR_MSAA: MSAA_WGSL,
  HAIR_LUT: HAIR_LUT_WGSL,
  HAIR_LIGHT: wgslModule(hairLightPassWgsl({ ...FULL_CONTRACT, lobeless: true })),
  HAIR_SKY_AO: hairSkyAoWgsl,
  HAIR_SURFACE_SHADOW: hairSurfaceShadowWgsl,
  ...environmentKernels(),
  HAIR_STATIC_LIGHT: hairStaticLightWgsl,
  HAIR_COMPOSE: wgslModule(hairComposeWgsl(true)),
  HAIR_COMPOSE_NO_LOCAL_FOG: wgslModule(hairComposeWgsl(false)),
  HAIR_SKY: wgslModule(hairSkyPassWgsl(false)),
  HAIR_SKY_CUBED: wgslModule(hairSkyPassWgsl(true)),
  HAIR_DEEP_SHADOW_ALLOCATE: DEEP_SHADOW_ALLOCATE_WGSL,
  HAIR_DEEP_SHADOW_RASTER: DEEP_SHADOW_RASTER_WGSL,
  HAIR_DEEP_SHADOW_MASK: DEEP_SHADOW_MASK_WGSL,
  HAIR_VOXEL_ALLOCATE_PAGE_INDEX: ALLOCATE_PAGE_INDEX_WGSL,
  HAIR_VOXEL_MARK_VALID: MARK_VALID_WGSL,
  HAIR_VOXEL_ALLOCATE_PAGES: ALLOCATE_PAGES_WGSL,
  HAIR_VOXEL_ADD_NODE: ADD_NODE_WGSL,
  HAIR_VOXEL_ADD_INDIRECT: ADD_INDIRECT_WGSL,
  HAIR_VOXEL_FEEDBACK: FEEDBACK_WGSL,
  HAIR_VOXEL_CLEAR_PAGES: CLEAR_PAGES_WGSL,
  HAIR_VOXEL_RASTER: VOXEL_RASTER_WGSL,
  HAIR_VOXEL_INJECT: VOXEL_INJECT_WGSL,
  HAIR_VOXEL_MIP_ARGS: MIP_ARGS_WGSL,
  HAIR_VOXEL_MIP: MIP_WGSL,
  HAIR_VOXEL_TRANSMITTANCE: voxelTransmittanceWgsl(false, false),
  HAIR_VOXEL_TRANSMITTANCE_MIP: voxelTransmittanceWgsl(true, false),
  HAIR_VOXEL_TRANSMITTANCE_SUPERSAMPLED: voxelTransmittanceWgsl(false, true),
  HAIR_VOXEL_TRANSMITTANCE_MIP_SUPERSAMPLED: voxelTransmittanceWgsl(true, true),
  HAIR_MATERIAL: MATERIAL_WGSL,
  HAIR_SAMPLE_COVERAGE: SAMPLE_COVERAGE_WGSL,
  HAIR_ONLY_DEPTH: hairGbufferWgsl(false),
  HAIR_SURFACE: hairGbufferWgsl(true),
  HAIR_DEPTH: HAIR_DEPTH_WGSL,
  ...shadowMaps(),
  HAIR_TILES: WORKGROUP_TILES_WGSL,
  HAIR_TILES_SUBGROUPS: SUBGROUP_TILES_WGSL,
  HAIR_TILE_ARGS: ARGS_WGSL,
  HAIR_NODE_ARGS: NODE_ARGS_WGSL,
  ...perCount(),
}
