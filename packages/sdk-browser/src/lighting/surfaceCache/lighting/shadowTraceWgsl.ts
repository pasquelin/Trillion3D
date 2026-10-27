import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { sceneTraceWgsl } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { ARGS_WRITER_WGSL } from './contextWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { shadowMaskBlockOf } from './shadowMaskWgsl.ts'

/**
 * THE SHADOW TRACES OF THE DIRECT LIGHT: the arguments of their dispatch, and the trace itself.
 *
 * `shadowTraceArgs` writes the groups of 64 traces the mask pass listed (`shadowMaskWgsl.ts`) into the context's header
 * (`CONTEXT_ARGS.shadowTraces`). `shadowTrace` is a thread a trace: it reads its light tile's page, tile and
 * light (`lightTiles`, which the mask pass wrote), the texel's entry (a byte, two in the coloured format) in the light tile's mask and, if it is not settled, casts a ray from the texel to the light through the scene's triangles (`sceneTraceWgsl.ts`, in the
 * group after the first) — any hit ends it; the front faces of a primitive that is not two-sided are culled unless
 * `surfaceCacheDirectLightingHardwareRayTracingForceTwoSided` makes all so; a translucent primitive and a placement that
 * casts no shadow are passed; no hit is ignored for being near the texel. A sun's ray goes as far as the cache's trace
 * reaches (`maxTrace`), a lamp's to the lamp less `traceEndBias` (a texel at the lamp, or within that bias of it, has nothing to cast through: not blocked, no ray); it starts off the texel by `traceRayBias`, three times
 * that where the surface turns from the light. A ray blocked by a hit, or that stopped before the walk was whole, shadows
 * the texel: its factor is 0; the byte is then settled. Where the trace answers a quad of four (downsample level 1), the
 * other three texels take the same answer.
 *
 * `shadowTraceArgs` binds the tables (1), the context (2) and the traces (3). `shadowTrace`'s bindings in group 0: 0 the
 * parameters, the cut's tables where the culling binds them (1, 6, 7, 9), 2 the surface tables, 3 the traces, 4 and 5 the depth
 * and normal layers, 8 the masks, 10 the lights, 11 the light tiles; group 1 is the scene trace's own. Eight storage buffers
 * with the scene trace's three: the tables, the traces, the masks, the lights and the light tiles.
 */

export const SHADOW_TRACE_BINDINGS = {
  tables: 2,
  traces: 3,
  depth: 4,
  normal: 5,
  masks: 8,
  lights: 10,
  lightTiles: 11,
} as const

const B = SHADOW_TRACE_BINDINGS

/** The scene trace's group and its first binding in it. */
export const SHADOW_TRACE_SCENE = { group: 1, first: 0 } as const

/** The args program's bindings: the tables, which every lighting program binds, the context it writes and the traces it counts. */
export const SHADOW_ARGS_BINDINGS = { tables: 1, context: 2, traces: 3 } as const

export const SHADOW_ARGS_ENTRY = 'shadowTraceArgs'

export const SHADOW_ARGS_WGSL = wgslProgram(
  `@group(0) @binding(${SHADOW_ARGS_BINDINGS.traces}) var<storage,read> traces:array<u32>;
@compute @workgroup_size(1)
fn ${SHADOW_ARGS_ENTRY}(){
 setArgs(ARGS_SHADOW_TRACES,groupGrid(ceilDiv(traces[0],${WORKGROUP_THREADS}u)));
}`,
  [
    lightingCommonWgsl({
      tables: SHADOW_ARGS_BINDINGS.tables,
      context: { binding: SHADOW_ARGS_BINDINGS.context, access: 'atomic' },
    }),
    ARGS_WRITER_WGSL,
  ],
)

export const SHADOW_TRACE_ENTRY = 'shadowTrace'

const shadowTraceProgram = (format: AtlasFormat) =>
  wgslProgram(
    `@group(0) @binding(${B.traces}) var<storage,read> traces:array<u32>;
@group(0) @binding(${B.masks}) var<storage,read_write> masks:array<atomic<u32>>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.lightTiles}) var<storage,read> lightTiles:array<u32>;
/** The byte of the texel \`coord\` in the mask of light tile \`lightTile\`. */
fn maskByteAt(lightTile:u32,coord:vec2u)->u32{
 let bit=shadowBit(coord);
 return shadowByteIn(atomicLoad(&masks[lightTile*SHADOW_MASK_TILE_WORDS+bit/32u]),bit);
}
/** Replaces that byte, \`was\` the thread's own read of it, the bits of the other texels of its word untouched: one xor of
 *  what changes, the byte being this thread's alone (a trace owns its texel and, at a downsample, the quad's other three). */
fn setMaskByte(lightTile:u32,coord:vec2u,was:u32,byte:u32){
 let bit=shadowBit(coord);
 let changed=was^byte;
 if(changed!=0u){atomicXor(&masks[lightTile*SHADOW_MASK_TILE_WORDS+bit/32u],changed<<(bit%32u));}
}
/** Whether the ray from the texel to light \`rank\` is blocked: it hits, or its walk did not end. */
fn shadowRayBlocked(texel:SurfaceTexel,rank:u32)->bool{
 let light=directLights.items[rank];
 var toward=-light.directionCone.xyz;
 var span=lp.maxTrace;
 if(!isSun(light)){
  let offset=light.positionRange.xyz*CM_PER_M-texel.position;
  span=min(span,max(length(offset)-lp.traceEndBias,0.0));
  // A texel at the lamp, or within the end bias of it, has no space to the lamp to cast through: no direction either.
  if(span<=0.0){return false;}
  toward=normalize(offset);
 }
 let bias=lp.traceRayBias*(1.0+2.0*saturate(1.0-dot(toward,texel.normal)));
 let origin=(texel.position+toward*bias-lp.camera.xyz)/CM_PER_M;
 var flags=ST_ANY_HIT|ST_SHADOW|ST_SKIP_TRANSLUCENT;
 if(!lgFlag(FLAG_FORCE_TWO_SIDED)){flags|=ST_CULL_FRONT;}
 let hit=stTrace(StRay(origin,toward,0.0,span/CM_PER_M,flags));
 return hit.hit||!stComplete;
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn ${SHADOW_TRACE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatGroup(group,n)*${WORKGROUP_THREADS}u+lane;
 if(i>=traces[0]){return;}
 let word=traces[1u+i];
 let lightTile=shadowTraceLightTile(word);
 let pageTile=lightTiles[lightTile*SHADOW_LIGHT_TILE_WORDS];
 let rank=lightTiles[lightTile*SHADOW_LIGHT_TILE_WORDS+1u];
 let coord=shadowTraceCoord(word);
 let byte=maskByteAt(lightTile,coord);
 var blocked=false;
 if((byte&SHADOW_COMPLETE)==0u){
  blocked=shadowRayBlocked(surfaceTexel(tilePage(pageTile),tileCoordOf(pageTile)*LG_TILE+coord),rank);
 }
 // The byte is kept as it is where the ray is free: its factor through a float and back may move by one step.
 setMaskByte(lightTile,coord,byte,select(byte,0u,blocked)|SHADOW_COMPLETE);
 if(shadowTraceDownsample(word)>0u){
  let shadowed=blocked||(byte&SHADOW_FACTOR_MAX)==0u;
  let base=coord&vec2u(SHADOW_QUAD_MASK);
  for(var q=0u;q<4u;q++){
   let other=base+vec2u(q%2u,q/2u);
   if(all(other==coord)){continue;}
   let was=maskByteAt(lightTile,other);
   setMaskByte(lightTile,other,was,select(was,0u,shadowed)|SHADOW_COMPLETE);
  }
 }
}`,
    [
      lightingCommonWgsl({ tables: B.tables }),
      surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
      shadowMaskBlockOf(format),
      CM_PER_M_WGSL,
      DIRECT_LIGHT_WGSL,
      sceneTraceWgsl(SHADOW_TRACE_SCENE.group, SHADOW_TRACE_SCENE.first),
    ],
  )

/** The trace over masks in the grey format, and over those of the light functions' coloured atlas (the texel's factor then a colour: the ray's answer is still 0 or 1 of all of it). */
export const SHADOW_TRACE_WGSL = shadowTraceProgram('grey')
export const SHADOW_TRACE_COLOURED_WGSL = shadowTraceProgram('colour')
