// The hair strands' passes' WGSL texts of `ENGINE_SHADERS`: the tangents, the bounds of the instances and of
// the macro groups, the transmittance of the ribbons and its resolve, the tiles, the raster of the visibility samples
// and the clear of them, and the compaction, each in the forms the device picks (the 64-bit maximum or two phases, two,
// four or eight samples a pixel), the materials of the samples, the depth of the nearest strand and the patch of
// the surfaces, and the shadow maps' marking and projection over the strands.
import { GROUP_BOUNDS_WGSL, MACRO_BOUNDS_WGSL } from '../../hair/boundsWgsl.ts'
import { compactWgsl, NODE_ARGS_WGSL } from '../../hair/compactionWgsl.ts'
import { clearWgsl, rasterWgsl } from '../../hair/rasterWgsl.ts'
import { HAIR_DEPTH_WGSL, hairGbufferWgsl } from '../../hair/gbufferWgsl.ts'
import { MATERIAL_WGSL, SAMPLE_COVERAGE_WGSL } from '../../hair/materialWgsl.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmPixelPageMarkingWgsl } from '../../lighting/shadows/vsm/markingWgsl.ts'
import {
  vsmLocalsProjectionWgsl,
  vsmSunsProjectionWgsl,
} from '../../lighting/shadows/vsm/projection/projectionWgsl.ts'
import { TANGENT_WGSL } from '../../hair/tangentWgsl.ts'
import { ARGS_WGSL, SUBGROUP_TILES_WGSL, WORKGROUP_TILES_WGSL } from '../../hair/tilesWgsl.ts'
import {
  CLEAR_TARGETS_WGSL,
  RESOLVE_WGSL,
  TRANSMITTANCE_WGSL,
} from '../../hair/transmittanceWgsl.ts'

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

export const HAIR_SHADERS: Record<string, string> = {
  HAIR_TANGENTS: TANGENT_WGSL,
  HAIR_GROUP_BOUNDS: GROUP_BOUNDS_WGSL,
  HAIR_MACRO_BOUNDS: MACRO_BOUNDS_WGSL,
  HAIR_TRANSMITTANCE: TRANSMITTANCE_WGSL,
  HAIR_TRANSMITTANCE_RESOLVE: RESOLVE_WGSL,
  HAIR_CLEAR_TARGETS: CLEAR_TARGETS_WGSL,
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
