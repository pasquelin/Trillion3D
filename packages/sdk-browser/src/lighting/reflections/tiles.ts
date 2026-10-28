import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { zOrderDecode } from '../../../../math/src/wgsl/integer.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { listWgsl } from '../../gpu/dispatch/list.ts'
import { REFLECTION_PIXEL_TRACES_WGSL } from './reach.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TILES_WGSL, REFLECTION_TRACE_BINDINGS as B } from './trace/traceBindings.ts'

/** The tiles a block of workgroups of the classification spans across and down (its workgroups follow the Z-order curve inside the block). */
const CLASSIFY_BLOCK = 8

/**
 * THE TILES A SURFACE'S REFLECTIONS RUN OVER, classified on the GPU every image (`classifyTiles`)
 * into four lists, so every later kernel runs only where it has work: a workgroup a TRACING tile of
 * `REFLECTION_SIDE`² grid texels (`grids.ts`), each thread a texel, reads its block's pixels — their
 * flags and, for a pixel that reflects, the lobe it traces (`reflectionPixelTraces`) —, and lists:
 *
 * - the tracing tile among the TRACING tiles (`tracingOut`) where a pixel of it traces — the ray generation
 *   (`generateRays`, `trace/trace.ts`) runs over these, picking each texel's pixel (`reflectionPickedPixel`) and writing its ray,
 *   then the screen stage —, else among the UNUSED ones (`clearTracingOut`), whose rays the clear empties (`clearTracing`), so no
 *   stale ray of an earlier image is left: no kernel reads a ray there;
 * - each of the RESOLVE tiles it covers, `REFLECTION_SIDE`² pixels inside the viewport — `block` of them a side, its
 *   texels' blocks being `block` pixels a side: one tile at a block of one pixel, four at two —, among the
 *   resolve tiles (`resolveOut`) where a pixel of it traces — the resolve, the accumulation and the
 *   last pass run over these —, else among the CLEAR ones (`clearOut`), where the last pass's clear
 *   empties the resolved pixels and the history and answers a pixel
 *   that reflects with the probes' field alone. The block divides `REFLECTION_SIDE` (1 or 2: the level's rows).
 *
 * The workgroups are dispatched in whole blocks of `CLASSIFY_BLOCK`² tiles, the grid's width a multiple of it (`classifyGroups`), and each takes its
 * tile along the Z-order curve of its block (a block after the other along the rows), the workgroups past the grid's edge returning at once: the tiles
 * of a list follow each other as neighbours on the screen.
 *
 * Every kernel after it is dispatched indirectly over one of its lists, a row's last workgroups past
 * the count returning at once, no read back.
 *
 * Cost: a thread a grid texel, a flag read for each of its block's pixels, a normal for each that
 * reflects and a lobe word for each that carries one; one
 * atomic a texel that traces; a word and three atomics a listed tile.
 */
export const REFLECTION_CLASSIFY_WGSL = wgslBlock(
  'REFLECTION_CLASSIFY_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_PIXEL_TRACES_WGSL,
    REFLECTION_TILES_WGSL,
    zOrderDecode,
    surfaceReflects,
    listWgsl({ name: 'tracingOut', group: 0, binding: B.tracingOut, entry: 'u32', append: true }),
    listWgsl({
      name: 'clearTracingOut',
      group: 0,
      binding: B.clearTracingOut,
      entry: 'u32',
      append: true,
    }),
    listWgsl({ name: 'resolveOut', group: 0, binding: B.resolveOut, entry: 'u32', append: true }),
    listWgsl({ name: 'clearOut', group: 0, binding: B.clearOut, entry: 'u32', append: true }),
  ],
  `/** The resolve tiles of the workgroup's tracing tile a pixel traces in, a bit each. */
var<workgroup> tileTraces:atomic<u32>;
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn classifyTiles(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 // The workgroups run in blocks of ${CLASSIFY_BLOCK}² tiles, a block after the other along the rows, the tiles of a block along the Z-order curve, so that tiles
 // that follow each other in a list are neighbours on the screen: the coherency of the trace that pulls its rays from them.
 let at=group.y*groups.x+group.x;
 let inBlock=zOrderDecode(at%${CLASSIFY_BLOCK * CLASSIFY_BLOCK}u);
 let block=at/${CLASSIFY_BLOCK * CLASSIFY_BLOCK}u;
 let across=groups.x/${CLASSIFY_BLOCK}u;
 let tile=vec2u((block%across)*${CLASSIFY_BLOCK}u,(block/across)*${CLASSIFY_BLOCK}u)+inBlock;
 if(any(tile*${REFLECTION_SIDE}u>=reflectionGridSize())){return;}
 let coord=tile*${REFLECTION_SIDE}u+local.xy;
 let inside=all(coord<reflectionGridSize());
 let viewport=reflectionViewport();
 var mask=0u;
 for(var k=0u;inside&&k<reflectionBlock().x*reflectionBlock().y;k++){
  let pixel=reflectionBlockPixel(coord,k);
  if(any(pixel>=viewport)){continue;}
  let flags=surfaceFlagsAt(vec2i(pixel));
  if(surfaceReflects(flags)&&reflectionPixelTraces(vec2i(pixel),flags)){mask|=1u<<k;}
 }
 // The resolve tiles of pixels this tracing tile of texels covers, \`resolves\` across and down: the texels a resolve tile holds, \`texels\` across and down.
 let resolves=reflectionBlock();
 let texels=vec2u(${REFLECTION_SIDE}u)/resolves;
 let resolve=local.xy/texels;
 if(mask!=0u){atomicOr(&tileTraces,1u<<(resolve.x+resolves.x*resolve.y));}
 workgroupBarrier();
 let traced=atomicLoad(&tileTraces);
 if(lane==0u){
  let entry=tile.x|(tile.y<<16u);
  if(traced!=0u){tracingOut.entries[tracingOutAppend(1u,1u)]=entry;}
  else{clearTracingOut.entries[clearTracingOutAppend(1u,1u)]=entry;}
 }
 if(lane<resolves.x*resolves.y){
  let resolveTile=tile*resolves+vec2u(lane%resolves.x,lane/resolves.x);
  if(all(resolveTile*${REFLECTION_SIDE}u<viewport)){
   let entry=resolveTile.x|(resolveTile.y<<16u);
   if(((traced>>lane)&1u)!=0u){resolveOut.entries[resolveOutAppend(1u,1u)]=entry;}
   else{clearOut.entries[clearOutAppend(1u,1u)]=entry;}
  }
 }
}
/** The clear of an unused tracing tile (\`clearTracingOut\`): its texels' depths set to none (\`REFLECTION_NO_RAY_DEPTH\`), so no
 *  kernel reads a ray of an earlier image there. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn clearTracing(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let g=reflectionTileOrigin(t)+local.xy;
 if(all(g<reflectionGridSize())){textureStore(surfaceRays,vec2i(g),REFLECTION_RAY_DEPTH,vec4u(bitcast<u32>(REFLECTION_NO_RAY_DEPTH),0u,0u,0u));}
}`,
)

/** The workgroups of the classification over a view drawn `size` pixels, one a tracing tile of its
 *  grid, a texel a block of `block` pixels across and down, written into `into`. */
export const classifyGroups = (
  size: readonly [number, number],
  block: readonly [number, number],
  into: [number, number],
) => {
  into[0] = ceilDiv(size[0], REFLECTION_SIDE * block[0] * CLASSIFY_BLOCK) * CLASSIFY_BLOCK
  into[1] = ceilDiv(size[1], REFLECTION_SIDE * block[1] * CLASSIFY_BLOCK) * CLASSIFY_BLOCK
  return into
}
