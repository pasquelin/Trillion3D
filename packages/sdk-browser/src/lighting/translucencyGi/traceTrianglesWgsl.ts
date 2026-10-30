import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { equalAreaDecode } from '../../../../math/src/wgsl/octahedral.ts'
import { dagReadLayoutEntries } from '../../geometry/dag/shader/bindings.ts'
import { computeStorageTextureEntry } from '../../gpu/core/computeBindings.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { bounceBindingsWgsl } from '../bounce/gridWgsl.ts'
import { spCommon } from '../bounce/screen/commonWgsl.ts'
import { spReach } from '../bounce/screen/probesWgsl.ts'
import { bindingTable } from '../bounce/screen/screenProbeLayout.ts'
import { TRACE_TRACED_HIT, TRACE_TRACED_SCENE } from '../bounce/screen/traceTracedWgsl.ts'
import { tracedHitLightWgsl } from '../bounce/tracedHitWgsl.ts'
import { sceneTraceAvoidWgsl } from '../rays/sceneTrace/avoidWgsl.ts'
import { sceneMaskedLayoutEntries } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { surfaceHitCardsLayoutEntries } from '../surfaceCache/hitWgsl.ts'
import { giFormatWgsl, giQuantizeWgsl, GI_VISIBLE_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_GI_GROUP } from './layout.ts'
import {
  GI_CELL_NOISE_WGSL,
  GI_PARAMS_WGSL,
  GI_TRACE_POINT_WGSL,
  TRACE_GI_LIGHT,
} from './traceWgsl.ts'

/**
 * The bindings of the cones' trace through the scene's triangles in group 0, clear of those the cut's tables (1, 6, 7, 9) and the surface cache's
 * cards (`TRACE_TRACED_HIT`) take: the screen probes' parameters (`spBase`), this volume's frame, the cascades' uniform and the blue noise; the
 * cones' light written is `TRACE_GI_LIGHT`. The cascades' table is declared and bound in no layout (the reach reads the cascades' uniform alone).
 */
export const TRACE_GI_TRIANGLES_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  frame: [3, 'uniform'],
  bounceGrid: [11, 'uniform'],
  blue: [13, 'float'],
})
/** The entry point of the program. */
export const TRACE_GI_TRIANGLES_ENTRY = 'traceConesTriangles'
const TRIANGLES_CELL_TABLE = 15
const C = TRACE_GI_TRIANGLES_BINDINGS.at

/** The layout of the group 0 of the trace through the triangles, the cones' light written in `format`, the cards read in `light`. */
export const traceGiTrianglesEntries = (
  format: GPUTextureFormat,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => [
  ...TRACE_GI_TRIANGLES_BINDINGS.entries,
  computeStorageTextureEntry(TRACE_GI_LIGHT, format, 'write-only', '3d'),
  ...dagReadLayoutEntries(),
  ...surfaceHitCardsLayoutEntries(TRACE_TRACED_HIT, light),
]
/** The layout of its scene trace group. */
export const traceGiTrianglesSceneEntries = () => sceneMaskedLayoutEntries(TRACE_TRACED_SCENE.first)

/**
 * THE CONES CAST THROUGH THE SCENE'S TRIANGLES (`traceConesTriangles`), a thread a cone, after the trace that reads the cache (`traceCones`) has
 * written the light of every cone with the global distance field not marched: the cone's ray leaves its cell's point (`giTracePoint`) along the
 * direction of its texel (jittered as the trace's are, `giCellNoise`) to the reach the radiance cache is trusted from (`spLocalReachBiased`, the
 * cascade `gi.temporal.w` coarser than the one that covers the point), the translucent primitives passed and the geometry the point lies in avoided as `surfaceCacheHardwareRayTracingAvoidSelfIntersections` says (`stTraceAvoiding`). A ray that hits
 * brings the light the surface cache holds at the hit (`tracedHitLight`, over the frame's depth bias and nearest hit, `gi.rays`) with the sky light that leaks at the hit's distance (`spSkyLeak`),
 * multiplied by the pre-exposure, held to the most a cone brings back and written over the cone's light; a ray that hits nothing leaves what the
 * first trace wrote — the radiance cache's light and the sky. A hit that brings no light (the back of a one-sided primitive, or nearer than the nearest hit) is a hit all the same: only the sky light that leaks remains.
 */
const giTrianglesEntry = (
  format: GPUTextureFormat,
  light: LightAtlasFormat,
  programs: SceneMaskPrograms,
) =>
  wgslBlock(
    `GI_TRIANGLES_ENTRY(${format},${light},${sceneMaskKey(programs)})`,
    [
      GI_PARAMS_WGSL,
      GI_TRACE_POINT_WGSL,
      GI_CELL_NOISE_WGSL,
      equalAreaDecode,
      sceneTraceAvoidWgsl(TRACE_TRACED_SCENE.group, TRACE_TRACED_SCENE.first, programs),
      tracedHitLightWgsl(TRACE_TRACED_HIT, TRACE_TRACED_SCENE, light, programs),
      giQuantizeWgsl(format),
      ...giFormatWgsl(format),
    ],
    `@group(0) @binding(${TRACE_GI_LIGHT}) var coneLight:texture_storage_3d<${format},write>;
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn ${TRACE_GI_TRIANGLES_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 giParams();
 let res=u32(gi.trace.x);
 let cell=vec3u(id.xy/res,id.z);
 if(any(cell>=gi.grid.xyz)||!giVisible(cell)){return;}
 let bias=u32(gi.temporal.w);
 let origin=giTracePoint(cell);
 let reach=select(spMaxTrace(),spLocalReachBiased(origin,bias,0.5),gi.spatial.w!=0.0);
 let cone=vec2f(id.xy-cell.xy*res);
 let d=equalAreaDecode((cone+giCellNoise(cell))/f32(res));
 // From the cell's point itself (no bias), passing the translucent primitives and avoiding the geometry the point lies in as the setting says.
 let hit=stTraceAvoiding(origin-view.display.yzw,d,0.0,reach,u32(gi.rays.z));
 // A trace that ended before its walk was whole with no hit is a black hit at the ray's end, as a hit that brings no light is: neither leaves it to the radiance cache.
 if(!hit.hit&&stComplete){return;}
 var radiance=spSkyLeak(d,select(reach,hit.distance,hit.hit));
 if(hit.hit){radiance+=tracedHitLight(hit,origin,d,gi.trace.x,gi.rays.x,gi.rays.y,vec2u(0u));}
 radiance*=gi.trace.z;
 let most=max(radiance.x,max(radiance.y,radiance.z));
 if(most>gi.trace.y){radiance*=gi.trace.y/most;}
 textureStore(coneLight,id,vec4f(giQuantize(radiance,id.xy,id.z),0.0));
}`,
  )

/** The program of the trace through the triangles, writing the cones' light in `format`. */
export const traceGiTrianglesProgram = (
  format: GPUTextureFormat,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) =>
  wgslProgram(
    `@group(0) @binding(${C.params}) var<uniform> spBase:ScreenProbeParams;
var<private> sp:ScreenProbeParams;
@group(0) @binding(${C.frame}) var<uniform> gi:TranslucencyGiFrame;`,
    [
      spCommon([1, 1]),
      bounceBindingsWgsl(0, C.bounceGrid, TRIANGLES_CELL_TABLE),
      spReach,
      blueNoiseWgsl(0, C.blue),
      GI_VISIBLE_WGSL,
      giTrianglesEntry(format, light, programs),
    ],
  )
