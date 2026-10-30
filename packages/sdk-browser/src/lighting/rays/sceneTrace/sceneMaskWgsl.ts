import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { rayTriangleBarycentric } from '../../../../../math/src/wgsl/geometry.ts'
import {
  RAY_TRACING_CORNER_AT,
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_FLAG_MASK_SET,
  RAY_TRACING_FLAG_MASK_SET_SHIFT,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import {
  RAY_TRACING_CORNER_WORDS,
  RAY_TRACING_MASK_CORNER_WORDS,
} from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { atlasLayoutEntries, type AtlasBindings } from '../../../gpu/bind/bindLayout.ts'
import {
  COMPUTE,
  computeSamplerEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { PREVIEW_LAYOUT_NAMES } from '../../../../../sdk-core/src/texture/previewFormat.ts'
import { maskSetOf } from '../../../materials/graph/maskProgram.ts'
import { materialTableWgsl } from '../../../materials/table/materialWgsl.ts'
import {
  colorSampleWgsl,
  maskAlphaWgsl,
  SHADOW_TILE_POOL_WGSL,
  tileDeclarations,
} from '../../../materials/virtual/wgsl.ts'
import { graphFrameEntry } from '../../../visibility/shader/graphFrameWgsl.ts'
import { maskGraphWgsl } from '../../../visibility/shader/maskGraphWgsl.ts'
import {
  TRACED_MASK_FLAGS,
  TRACED_MASK_SET_SHIFT,
  TRACED_MATERIAL_AT,
} from '../../reflections/translucency/materialWords.ts'
import { CORNER_WORD } from './sceneHitCornersWgsl.ts'
import { NO_SCENE_MASKS, sceneMaskKey, type SceneMaskPrograms } from './sceneMaskPrograms.ts'
import { SCENE_TRACE_BINDINGS, sceneTraceLayoutEntries } from './sceneTraceWgsl.ts'

/** The bindings of the any-hit test, in the scene trace's group, past the trace's (from `first`): the colour atlas's lanes and page table, the sampler of the maps, the surfaces' records and the graph frame (which a graph's mask is read and clocked by). The triangles' corners it reads are in the trace's geometry. */
export const sceneMaskBindings = (first: number) => {
  const lanes = PREVIEW_LAYOUT_NAMES.map((_, lane) => first + SCENE_TRACE_BINDINGS + lane)
  const color: AtlasBindings = { lanes, pages: first + SCENE_TRACE_BINDINGS + lanes.length }
  const sampler = color.pages + 1
  return { color, sampler, table: sampler + 1, frame: sampler + 2 }
}

/** The bindings the any-hit test takes from `first` end before `first + SCENE_MASK_END`: a program that binds more of its own in the group starts there. */
export const SCENE_MASK_END = sceneMaskBindings(0).frame + 1

/** The layout entries of the any-hit test from `first` (`sceneMaskBindings`), past the scene trace's own (`sceneTraceLayoutEntries`). */
export const sceneMaskLayoutEntries = (first: number): GPUBindGroupLayoutEntry[] => {
  const b = sceneMaskBindings(first)
  return [
    ...atlasLayoutEntries(b.color, COMPUTE),
    computeSamplerEntry(b.sampler, 'filtering', COMPUTE),
    computeTextureEntry(b.table, 'uint', '2d-array'),
    graphFrameEntry(b.frame, COMPUTE),
  ]
}

/** The layout entries of a group that holds the scene trace and its any-hit test from `first`: what every ray-casting pass lists, the path tracer's included (`sceneTraceGroupBinder` binds them). */
export const sceneMaskedLayoutEntries = (first: number): GPUBindGroupLayoutEntry[] => [
  ...sceneTraceLayoutEntries(first),
  ...sceneMaskLayoutEntries(first),
]

/** What the any-hit test reads beside the scene trace's own resources: the colour atlas and the sampler of the maps, the surfaces' records and the graph frame of the image (`graphFrameWgsl.ts`). */
export interface SceneMaskResources {
  readonly color: {
    readonly views: readonly GPUTextureView[]
    readonly pages: { readonly buffer: GPUBuffer }
  }
  readonly sampler: GPUSampler
  readonly table: GPUTextureView
  readonly frame: GPUBuffer
}

/** The bind group entries of the any-hit test from `first`, over the atlas `read`. */
export const sceneMaskBindEntries = (
  read: SceneMaskResources,
  first: number,
): GPUBindGroupEntry[] => {
  const b = sceneMaskBindings(first)
  return [
    ...b.color.lanes.map((binding, lane) => ({ binding, resource: read.color.views[lane]! })),
    { binding: b.color.pages, resource: { buffer: read.color.pages.buffer } },
    { binding: b.sampler, resource: read.sampler },
    { binding: b.table, resource: read.table },
    { binding: b.frame, resource: { buffer: read.frame } },
  ]
}

const M = TRACED_MATERIAL_AT

/** `stMaskWord`: where in the table begin the material words the any-hit test reads for a triangle of the record `record`, whose flags are `flags`, met through the placement `placement`: the placement's, or, for an HLOD
 *  actor's record, the actor's own — at the rank of the material its record names (`RAY_TRACING_RECORD_AT.primitive`), from `stParams.actorWord` —, since the placement an actor is walked through is the world's, which wears no
 *  surface of an actor's. `NO_INDEX` for an actor's record that names none (a file from before it did): its triangles are kept. */
export const MASK_WORD = wgslBlock(
  'MASK_WORD',
  [NO_INDEX],
  `fn stMaskWord(placement:u32,record:u32,flags:u32)->u32{
 if((flags&ST_IS_ACTOR)==0u){return stParams.materialWord+placement*ST_MATERIAL_WORDS;}
 let rank=stTable[record*ST_RECORD_WORDS+ST_RECORD_PRIMITIVE];
 return select(stParams.actorWord+rank*ST_MATERIAL_WORDS,NO_INDEX,rank==NO_INDEX);
}`,
)

/** `stMasked`: whether the surface of a record met through a placement is masked (`TRACED_MASK_FLAGS.masked`), asked once per instance so that an opaque surface never reads its triangles' cutout: false for an actor's record that names no material. */
const MASKED = wgslFn(
  'stMasked',
  [MASK_WORD, NO_INDEX],
  `fn stMasked(placement:u32,record:u32,flags:u32)->bool{
 let at=stMaskWord(placement,record,flags);
 return at!=NO_INDEX&&(stTable[at+${M.mask}u]&${TRACED_MASK_FLAGS.masked}u)!=0u;
}`,
)

/** `stMaskCorner`: what the any-hit test reads of a triangle's corners, at the weights bary of the second and third corners: the coordinate of the texture set asked (`uvSet`, 0 to 7) and, where `coloured`, the vertex colour's alpha — a few words a corner, not the whole of `stCornerSurface`. The coordinate is the cutout
 *  coordinate of the corners (`stTable` from `stParams.maskWord`, the triangle's place in it from its record) where the record names the set asked, else the first set's. */
const MASK_CORNER = wgslBlock(
  'MASK_CORNER',
  [CORNER_WORD],
  `struct StMaskCorner{uv:vec2f,alpha:f32,}
fn stMaskCorner(triangle:u32,record:u32,flags:u32,bary:vec2f,uvSet:u32,coloured:bool)->StMaskCorner{
 let w=vec3f(1.0-bary.x-bary.y,bary.x,bary.y);
 let at=record*ST_RECORD_WORDS;
 let named=(flags&${RAY_TRACING_FLAG_MASK_SET}u)>>${RAY_TRACING_FLAG_MASK_SET_SHIFT}u;
 let carried=uvSet!=0u&&uvSet==named;
 let first=stTable[at+ST_RECORD_MASK_TRIANGLE]+triangle-stTable[at+ST_RECORD_FIRST_TRIANGLE];
 var out:StMaskCorner;
 out.alpha=1.0;
 if(coloured){out.alpha=0.0;}
 for(var k=0u;k<3u;k++){
  let word=(triangle*3u+k)*${RAY_TRACING_CORNER_WORDS}u;
  if(carried){
   let cutout=(first*3u+k)*${RAY_TRACING_MASK_CORNER_WORDS}u;
   out.uv+=w[k]*vec2f(bitcast<f32>(stTable[stParams.maskWord+cutout]),bitcast<f32>(stTable[stParams.maskWord+cutout+1u]));
  }else{
   out.uv+=w[k]*vec2f(bitcast<f32>(stCornerWord(word+${RAY_TRACING_CORNER_AT.uvX}u)),bitcast<f32>(stCornerWord(word+${RAY_TRACING_CORNER_AT.uvY}u)));
  }
  if(coloured){out.alpha+=w[k]*f32(stCornerWord(word+${RAY_TRACING_CORNER_AT.colour}u)>>24u)/255.0;}
 }
 return out;
}`,
)

/** The mask functions of `programs` at the bindings of the any-hit test from `first` in `group`: the graphs' `opacityMask` read as the rasters read it (`maskGraphWgsl`), at the finest level, with the records and the frame of the image bound beside. */
const sceneGraphMasks = (group: number, first: number, programs: SceneMaskPrograms) => {
  const b = sceneMaskBindings(first)
  const masks = maskSetOf(
    programs,
    b.frame,
    colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
    '1.0',
    undefined,
    { group, table: b.table },
  )
  return [materialTableWgsl(b.table, group), maskGraphWgsl(masks)]
}

/**
 * THE ANY-HIT TEST OF THE MASKED SURFACES (`stMaskKeeps`, which the scene trace calls on each triangle a ray would take and replaces its default that keeps
 * them all): the surface a placement wears is cut where its alpha at the hit is under the threshold of its record, and the ray goes on past the triangle.
 * The alpha is the surface's opacity, times its base map's alpha read at the hit's texture coordinate at the finest level (no derivative, as a path reads it),
 * times the vertex colour's alpha on a surface that reads it; the coordinate is the one of the texture set the base map reads (the first, or the set the cutout names where the record carries its coordinates); a triangle without corner attributes is read at the coordinate zero. The placement's
 * cutout — for a triangle of an HLOD actor, the cutout of the actor's own material (`stMaskWord`), not of the world's placement it is walked through — is in the material words of the scene trace's table (`TRACED_MATERIAL_AT.cut` on, `sceneMaskWords.ts`); the corners are in the trace's table and the colour atlas is the group's, from
 * `first` (`sceneMaskBindings`). A surface whose mask a graph computes is cut by that mask (`maskGraphValue`, as the rasters do: the output of the graph at the hit's coordinate, no
 * derivative, less the clip value of its record, kept where not below zero) when `programs` holds its program; the record is the one the placement's words name
 * (`TRACED_MASK_FLAGS.graph`, `sceneMaskWords.ts`). A program `programs` lacks (a graph that joined the session since the kernel was made) keeps its triangles whole.
 */
export const sceneMaskWgsl = (
  group: number,
  first: number,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) => {
  const b = sceneMaskBindings(first)
  const graphs = programs.length > 0
  const graphTest = graphs
    ? `return maskGraphValue(materialAt(stTable[at+${M.map}u]),uv,vec2f(0.0),vec2f(0.0))>=0.0;`
    : 'return true;'
  return wgslFn(
    'stMaskKeeps',
    [
      wgslBlock(
        `SCENE_MASK_DECLARATIONS(${group},${first}${graphs ? `,${sceneMaskKey(programs)}` : ''})`,
        [
          MASKED,
          MASK_WORD,
          MASK_CORNER,
          rayTriangleBarycentric,
          maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL),
          ...(graphs ? sceneGraphMasks(group, first, programs) : []),
        ],
        `${tileDeclarations(b.color, 'color', group)}
@group(${group}) @binding(${b.sampler}) var mapsSampler:sampler;`,
      ),
    ],
    `fn stMaskKeeps(placement:u32,record:u32,triangle:u32,origin:vec3f,direction:vec3f,a:vec3f,b:vec3f,c:vec3f)->bool{
 let flags=stTable[record*ST_RECORD_WORDS+ST_RECORD_FLAGS];
 let at=stMaskWord(placement,record,flags);
 if(at==NO_INDEX){return true;}
 let bits=stTable[at+${M.mask}u];
 if((bits&${TRACED_MASK_FLAGS.masked}u)==0u){return true;}
 var uv=vec2f(0.0);
 var vertexAlpha=1.0;
 if((flags&${RAY_TRACING_FLAG_ATTRIBUTES}u)!=0u){
  let corner=stMaskCorner(triangle,record,flags,rayTriangleBarycentric(origin,direction,a,b,c),(bits>>${TRACED_MASK_SET_SHIFT}u)&7u,(bits&${TRACED_MASK_FLAGS.coloured}u)!=0u);
  uv=corner.uv;
  vertexAlpha=corner.alpha;
 }
 if((bits&${TRACED_MASK_FLAGS.graph}u)!=0u){${graphTest}}
 var alpha=saturate(bitcast<f32>(stTable[at+${M.opacity}u]));
 if((bits&${TRACED_MASK_FLAGS.mapped}u)!=0u){alpha*=maskAlpha(stTable[at+${M.map}u],uv,vec2f(0.0),vec2f(0.0),(bits&${TRACED_MASK_FLAGS.sampled}u)!=0u);}
 if((bits&${TRACED_MASK_FLAGS.coloured}u)!=0u){alpha*=vertexAlpha;}
 return alpha>=bitcast<f32>(stTable[at+${M.cut}u]);
}`,
  )
}
