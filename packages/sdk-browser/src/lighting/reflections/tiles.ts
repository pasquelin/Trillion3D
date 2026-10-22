import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { listWgsl } from '../../gpu/dispatch/list.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TILES_WGSL, REFLECTION_TRACE_BINDINGS as B } from './trace/traceBindings.ts'

/** A tracing tile's resolve tiles a side: its texels' blocks, `REFLECTION_SIDE` pixels each. */
const RESOLVES = 2

/**
 * THE TILES A SURFACE'S REFLECTIONS RUN OVER, classified on the GPU every image (`classifyTiles`)
 * into four lists, so every later kernel runs only where it has work: a workgroup a TRACING tile of
 * `REFLECTION_SIDE`² grid texels (`grids.ts`), each thread a texel, reads its block's pixels — their
 * flags and, for a pixel that reflects, the lobe it traces (`reflectionPixelTraces`) —, picks the
 * pixel the texel casts from this image (`classifyPicked`, the tile jitter held to the viewport), and
 * lists:
 *
 * - the tracing tile among the TRACING tiles (`tracingOut`) where a pixel of it traces — the screen
 *   stage runs over these, writing the picked pixels' ray words the classification wrote —, else among
 *   the UNUSED ones (`clearTracingOut`), whose ray words the clear empties (`clearTracing`), so no
 *   stale ray of an earlier image is left: no kernel reads a ray there;
 * - each of its `RESOLVES`² RESOLVE tiles, `REFLECTION_SIDE`² pixels inside the viewport, among the
 *   resolve tiles (`resolveOut`) where a pixel of it traces — the resolve, the accumulation and the
 *   last pass run over these —, else among the CLEAR ones (`clearOut`), where the last pass's clear
 *   empties the resolved pixels and the history and answers a pixel
 *   that reflects with the probes' field alone.
 *
 * Every kernel after it is dispatched indirectly over one of its lists, a row's last workgroups past
 * the count returning at once, no read back.
 *
 * Cost: a thread a grid texel, a flag read for each of its block's pixels, a normal for each that
 * reflects and a lobe word for each that carries one; a ray word a texel of a tracing tile; one
 * atomic a texel that traces; a word and three atomics a listed tile.
 */
export const REFLECTION_CLASSIFY_WGSL = wgslBlock(
  'REFLECTION_CLASSIFY_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_REACH_WGSL,
    REFLECTION_TILES_WGSL,
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
/** Whether the reflecting pixel \`coord\` of flags \`flags\` traces: where the lobe it traces — its clear
 *  coat where it carries one, its base elsewhere (\`surfaceTopAt\`) — answers a share of its rays
 *  (\`reflectionTraceShare\`, \`reach.ts\`): its roughness under the roughness a lobe traces to.
 *  The base lobe's narrower width is its round one (αt ≥ α, \`lobesWgsl.ts\`), so its roughness alone
 *  decides it. */
fn reflectionPixelTraces(coord:vec2i,flags:u32)->bool{
 return reflectionTraceShare(lobeAlpha(surfaceTopAt(coord,flags).w))>0.0;
}
/** The pixel texel \`g\` casts from this image: its jitter (\`reflectionJitter\`), held to the viewport,
 *  so a block cut by the viewport's edge still casts from a pixel inside it. */
fn classifyPicked(g:vec2u)->vec2u{
 return min(g*reflectionBlock()+reflectionJitter(g),reflectionViewport()-vec2u(1u));
}
/** The ray word (\`rayPack\`) of texel \`g\`, whose block's traced pixels are \`mask\`, a bit each in its
 *  pixels' order: the rank of the pixel this image picks (\`classifyPicked\`), under the traced bit where
 *  it traces — a picked pixel that does not trace casts no ray, never handing it to a block neighbour. */
fn classifyTraced(mask:u32,g:vec2u)->u32{
 let o=classifyPicked(g)-g*reflectionBlock();
 let k=o.x+o.y*reflectionBlock();
 return k|select(0u,REFLECTION_TRACED,((mask>>k)&1u)!=0u);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn classifyTiles(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let coord=tile.xy*${REFLECTION_SIDE}u+local.xy;
 let inside=all(coord<reflectionGridSize());
 let viewport=reflectionViewport();
 var mask=0u;
 for(var k=0u;inside&&k<reflectionBlock()*reflectionBlock();k++){
  let pixel=reflectionBlockPixel(coord,k);
  if(any(pixel>=viewport)){continue;}
  let flags=surfaceFlagsAt(vec2i(pixel));
  if(surfaceReflects(flags)&&reflectionPixelTraces(vec2i(pixel),flags)){mask|=1u<<k;}
 }
 let resolve=local.xy/${REFLECTION_SIDE / RESOLVES}u;
 if(mask!=0u){atomicOr(&tileTraces,1u<<(resolve.x+${RESOLVES}u*resolve.y));}
 workgroupBarrier();
 let traced=atomicLoad(&tileTraces);
 if(traced!=0u&&inside){textureStore(surfaceRays,coord,vec4u(classifyTraced(mask,coord),0u,0u,0u));}
 if(lane==0u){
  let entry=tile.x|(tile.y<<16u);
  if(traced!=0u){tracingOut.entries[tracingOutAppend(1u,1u)]=entry;}
  else{clearTracingOut.entries[clearTracingOutAppend(1u,1u)]=entry;}
 }
 if(lane<${RESOLVES * RESOLVES}u){
  let at=tile.xy*${RESOLVES}u+vec2u(lane%${RESOLVES}u,lane/${RESOLVES}u);
  if(all(at*${REFLECTION_SIDE}u<viewport)){
   let entry=at.x|(at.y<<16u);
   if(((traced>>lane)&1u)!=0u){resolveOut.entries[resolveOutAppend(1u,1u)]=entry;}
   else{clearOut.entries[clearOutAppend(1u,1u)]=entry;}
  }
 }
}
/** The clear of an unused tracing tile (\`clearTracingOut\`): its texels' ray words emptied, so no
 *  kernel reads a ray of an earlier image there. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn clearTracing(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let g=reflectionTileOrigin(t)+local.xy;
 if(all(g<reflectionGridSize())){textureStore(surfaceRays,vec2i(g),vec4u(0u));}
}`,
)

/** The workgroups of the classification over a view drawn `size` pixels, one a tracing tile of its
 *  grid, a texel a block of `block` pixels a side, written into `into`. */
export const classifyGroups = (
  size: readonly [number, number],
  block: number,
  into: [number, number],
) => {
  const side = REFLECTION_SIDE * block
  into[0] = ceilDiv(size[0], side)
  into[1] = ceilDiv(size[1], side)
  return into
}
