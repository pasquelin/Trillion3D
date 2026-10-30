// The sampled lighting's WGSL texts of `ENGINE_SHADERS`: the tiles' bits, lists and arguments, the clearing and the hash, and the sampling of each
// class of tile with and without the rectangle lights, under the program with every code path.
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { FULL_CONTRACT } from '../../lighting/deferred/contractCuts.ts'
import { TILE_CLASSES } from '../../lighting/deferred/tileClass.ts'
import { clearResolvedWgsl } from '../../lighting/manyLightsSampled/clearResolvedWgsl.ts'
import { filterHashWgsl, hashWgsl } from '../../lighting/manyLightsSampled/hashWgsl.ts'
import { TILE_OVERLAY_WGSL } from '../../lighting/manyLightsSampled/debug/tileOverlay.ts'
import { castersWgsl } from '../../lighting/manyLightsSampled/debug/casters/castersWgsl.ts'
import { castersHairWgsl } from '../../lighting/manyLightsSampled/debug/casters/castersHairWgsl.ts'
import { VISUALIZE_WGSL } from '../../lighting/manyLightsSampled/debug/visualizeWgsl.ts'
import { clearSamplesWgsl, samplingWgsl } from '../../lighting/manyLightsSampled/samplingWgsl.ts'
import { compactArgsWgsl, compactWgsl } from '../../lighting/manyLightsSampled/compactWgsl.ts'
import { softwareTraceWgsl } from '../../lighting/manyLightsSampled/softwareTraceWgsl.ts'
import { SUNS_LAYOUT } from '../../lighting/shadows/vsm/layout.fixture.ts'
import { vsmSampleMarkingWgsl } from '../../lighting/manyLightsSampled/vsmSampleMarkingWgsl.ts'
import { frontLightWgsl } from '../../lighting/manyLightsSampled/frontLightWgsl.ts'
import { injectProgram } from '../../lighting/translucency/injectWgsl.ts'
import { volumeHashText, volumeSampleText } from '../../lighting/manyLightsSampled/volumeText.ts'
import { hairLightPassWgsl } from '../../hair/hairLightWgsl.ts'
import { hairSurfaceTraceWgsl } from '../../lighting/manyLightsSampled/hairSurfaceTraceWgsl.ts'
import { hairMaskWgsl, hairSampleWgsl } from '../../lighting/manyLightsSampled/hairWgsl.ts'
import { powerDeltaWgsl } from '../../lighting/manyLightsSampled/powerDeltaWgsl.ts'
import { spatialWgsl } from '../../lighting/manyLightsSampled/spatialWgsl.ts'
import { temporalWgsl } from '../../lighting/manyLightsSampled/temporalWgsl.ts'
import {
  costWgsl,
  HEATMAP_WGSL,
} from '../../lighting/manyLightsSampled/debug/complexity/costWgsl.ts'
import { replayWgsl } from '../../lighting/manyLightsSampled/debug/complexity/replayWgsl.ts'
import { shadingWgsl } from '../../lighting/manyLightsSampled/shadingWgsl.ts'
import { vsmTraceSamplesWgsl } from '../../lighting/manyLightsSampled/vsmTraceWgsl.ts'
import { screenTraceWgsl } from '../../lighting/manyLightsSampled/screenTraceWgsl.ts'
import {
  frontTileArgsWgsl,
  frontTileListWgsl,
} from '../../lighting/manyLightsSampled/frontTilesWgsl.ts'
import {
  tileArgsWgsl,
  tileBitmaskWgsl,
  tileListsWgsl,
} from '../../lighting/manyLightsSampled/tileWgsl.ts'

export const SAMPLED_LIGHTS_SHADERS: Record<string, string> = {
  SAMPLED_TILE_BITS: tileBitmaskWgsl(),
  SAMPLED_FRONT_TILE_BITS: tileBitmaskWgsl(true),
  SAMPLED_FRONT_TILE_LIST: frontTileListWgsl(),
  SAMPLED_FRONT_TILE_ARGS: frontTileArgsWgsl(),
  SAMPLED_TILE_LISTS: tileListsWgsl(),
  SAMPLED_TILE_ARGS: tileArgsWgsl(),
  SAMPLED_CLEAR: clearSamplesWgsl(),
  SAMPLED_HASH: hashWgsl(),
  SAMPLED_FILTER_HASH: filterHashWgsl(),
  SAMPLED_CLEAR_RESOLVED: clearResolvedWgsl(),
  SAMPLED_TILE_OVERLAY: TILE_OVERLAY_WGSL,
  SAMPLED_VISUALIZE: VISUALIZE_WGSL,
  SAMPLED_CASTERS: castersWgsl(),
  SAMPLED_CASTERS_HAIR: castersHairWgsl(),
  SAMPLED_SCREEN_TRACE: screenTraceWgsl(),
  // The traces of a view whose pixels hold several closures.
  SAMPLED_SCREEN_TRACE_CLOSURES: screenTraceWgsl(true),
  SAMPLED_SOFTWARE_TRACE: softwareTraceWgsl(false),
  // The same with the field's coarse mip read through the hardware's filter (`float32-filterable`).
  SAMPLED_SOFTWARE_TRACE_FILTERED_MIP: softwareTraceWgsl(true),
  SAMPLED_MAP_TRACE: vsmTraceSamplesWgsl(),
  SAMPLED_MAP_TRACE_CLASSIC: vsmTraceSamplesWgsl(true),
  SAMPLED_MAP_TRACE_CLOSURES: vsmTraceSamplesWgsl(false, true),
  SAMPLED_MAP_TRACE_CLASSIC_CLOSURES: vsmTraceSamplesWgsl(true, true),
  SAMPLED_MAP_MARKING: vsmSampleMarkingWgsl(SUNS_LAYOUT),
  SAMPLED_MAP_MARKING_THROTTLED: vsmSampleMarkingWgsl(SUNS_LAYOUT, true),
  SAMPLED_TEMPORAL: temporalWgsl(),
  SAMPLED_SPATIAL: spatialWgsl(),
  // The same for a view whose pixels hold several closures.
  SAMPLED_SPATIAL_CLOSURES: spatialWgsl(false, true),
  SAMPLED_SPATIAL_DEBUG: spatialWgsl(true),
  SAMPLED_SPATIAL_DEBUG_CLOSURES: spatialWgsl(true, true),
  SAMPLED_POWER_DELTA: powerDeltaWgsl(),
  SAMPLED_COMPLEXITY_REPLAY: wgslModule(replayWgsl(FULL_CONTRACT, false, true)),
  SAMPLED_COMPLEXITY_REPLAY_FRONT: wgslModule(replayWgsl(FULL_CONTRACT, true, false)),
  SAMPLED_COMPLEXITY_COST: costWgsl(),
  SAMPLED_COMPLEXITY_HEATMAP: wgslModule(HEATMAP_WGSL),
  SAMPLED_FRONT_LIGHT: frontLightWgsl(),
  SAMPLED_TRANSLUCENCY_INJECT: injectProgram(true),
  SAMPLED_VOLUME_SAMPLE: volumeSampleText({ field: false, pyramid: false }),
  SAMPLED_VOLUME_SAMPLE_FIELD: volumeSampleText({ field: true, pyramid: false }),
  SAMPLED_VOLUME_SAMPLE_PYRAMID: volumeSampleText({ field: false, pyramid: true }),
  SAMPLED_VOLUME_SAMPLE_FIELD_PYRAMID: volumeSampleText({ field: true, pyramid: true }),
  SAMPLED_VOLUME_HASH: volumeHashText(),
  SAMPLED_HAIR_SURFACE_TRACE: hairSurfaceTraceWgsl(),
  SAMPLED_HAIR_DRAWS: hairSampleWgsl(),
  SAMPLED_HAIR_MASKS: hairMaskWgsl(false),
  SAMPLED_HAIR_MASKS_MIP: hairMaskWgsl(true),
  SAMPLED_HAIR_LIGHT: wgslModule(hairLightPassWgsl({ ...FULL_CONTRACT, lobeless: true }, true)),
  SAMPLED_COMPACT: compactWgsl(),
  SAMPLED_COMPACT_ARGS: compactArgsWgsl(),
  ...Object.fromEntries(
    TILE_CLASSES.flatMap((tileClass) =>
      [false, true].map((rect) => [
        `SAMPLED_SAMPLING_${tileClass}_${rect ? 'RECT' : 'PLAIN'}`,
        wgslModule(samplingWgsl(FULL_CONTRACT, tileClass, rect)),
      ]),
    ),
  ),
  ...Object.fromEntries(
    TILE_CLASSES.map((tileClass) => [
      `SAMPLED_SAMPLING_${tileClass}_FRONT`,
      wgslModule(samplingWgsl(FULL_CONTRACT, tileClass, false, true)),
    ]),
  ),
  ...Object.fromEntries(
    TILE_CLASSES.flatMap((tileClass) =>
      [false, true].map((rect) => [
        `SAMPLED_SHADING_${tileClass}_${rect ? 'RECT' : 'PLAIN'}`,
        wgslModule(shadingWgsl(FULL_CONTRACT, tileClass, rect)),
      ]),
    ),
  ),
  // The sampling and the shading of a view whose pixels hold several closures (`ContractKey.closures`).
  ...Object.fromEntries(
    TILE_CLASSES.flatMap((tileClass) => [
      [
        `SAMPLED_SAMPLING_${tileClass}_CLOSURES`,
        wgslModule(samplingWgsl({ ...FULL_CONTRACT, closures: true }, tileClass, false)),
      ],
      [
        `SAMPLED_SHADING_${tileClass}_CLOSURES`,
        wgslModule(shadingWgsl({ ...FULL_CONTRACT, closures: true }, tileClass, false)),
      ],
    ]),
  ),
}
