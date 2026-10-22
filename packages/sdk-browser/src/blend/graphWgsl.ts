import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import type { GraphOutput } from '../../../sdk-core/src/world/material/graph/outputs.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { fallbackOf } from '../materials/graph/program.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { graphLoadWgsl } from '../materials/graph/tableValues.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_TEXELS } from '../materials/table/materialLayout.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { requestLoopFn } from '../materials/virtual/requestWgsl.ts'
import { MATERIAL_RANK_MASK } from '../visibility/types.ts'

/**
 * THE GRAPHS OF THE TRANSPARENT PASS: the blend module holds the functions of every program of the
 * graphs its items wear (`blendGraphs`) and evaluates the program of each fragment's item once,
 * among the screen derivatives (`blendGrads`, `shaderSurface.ts`), before any fragment is rejected:
 * the outputs, held as the reference holds them, and the tile its textures ask. A texture read's
 * footprint is found at the contexts a pixel to the right and a pixel below (`neighboursOf`), which
 * the screen derivatives of the context give. The item's record names its
 * values in the material table (`graph`) and the first of them, its header, the program (`id`): a
 * switch picks the program's function. The items of one quad share a primitive, so the derivatives
 * the switch takes are those of its own pixels; the module says so (`derivative_uniformity` off).
 *
 * The context a fragment gives its graph: the first texture set (`in.uv.xy`), the set past it a lobed
 * program carries (`in.uv.zw`, the one the record names: `channelsOfGraph`) at the sets the graph
 * reads past the first, the world position, the camera, the interpolated normal — the pixel's normal
 * is the vertex normal; the graph's own normal bends it in `blendSurface` — and the time. The
 * position of the object is zero: its varying is not there (the stage's sixteen).
 */
export interface BlendGraphs {
  /** The declarations: the functions of the programs, the evaluation and the item's values. */
  readonly decl: WgslDecl
  /** Tells this set of programs apart: part of the names of what holds it. */
  readonly key: string
}

/** The bits of `BlendGraph.flags`: the graph wires a normal, a thin transmission colour. */
export const GRAPH_FLAG = { normal: 1, thin: 2 } as const

/** The record's word of a surface's graph, one lane of one texel (`materialGraphOf`). */
const GRAPH_TEXEL = MATERIAL_RECORD.at.graph >> 2
const GRAPH_LANE = 'xyzw'[MATERIAL_RECORD.at.graph & 3]

/** The code that calls the output `name` of the program `p` at the fragment, or its default. */
const outputOf = ({ compiled }: SurfaceProgram, name: GraphOutput) => {
  const fn = compiled.functions[name]
  return fn ? `${fn}(ctx,g)` : fallbackOf(name).code
}

/** The context of the fragment: the sets the graph reads, the world, the view and the clock. */
function contextOf({ compiled }: SurfaceProgram, lobes: boolean) {
  const extra = (compiled.uses.sets >> 1) & 7
  const alt = extra ? 31 - Math.clz32(extra & -extra) + 1 : 0
  const sets = Array.from({ length: 8 }, (_, set) =>
    lobes && set === alt && alt ? 'in.uv.zw' : 'in.uv.xy',
  )
  return ` var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(${sets.join(',')});
 ctx.world=in.view;ctx.eye=uni.eye.xyz;ctx.origin=vec3f(0.0);
 ctx.vertexNormal=unitOrZero(in.normal.xyz);ctx.pixelNormal=ctx.vertexNormal;
 ctx.time=uni.time;ctx.realTime=uni.time;
`
}

/** The contexts a pixel to the right and a pixel below are read in, for the footprint of a texture
 *  read (\`mgNeighbour\`): the sets and the position moved by their screen derivatives, taken here,
 *  before any branch that is not the quad's, so that no program takes one of its own. */
function neighboursOf({ compiled }: SurfaceProgram, lobes: boolean) {
  if (!compiled.uses.textures) return ''
  const sets = (step: 'dpdx' | 'dpdy') => {
    const extra = (compiled.uses.sets >> 1) & 7
    const alt = extra ? 31 - Math.clz32(extra & -extra) + 1 : 0
    return Array.from({ length: 8 }, (_, set) =>
      lobes && set === alt && alt ? `in.uv.zw+${step}(in.uv.zw)` : `in.uv.xy+${step}(in.uv.xy)`,
    ).join(',')
  }
  return ` mgNeighbour[0]=ctx;mgNeighbour[1]=ctx;
 mgNeighbour[0].uvs=array<vec2f,8>(${sets('dpdx')});mgNeighbour[0].world=in.view+dpdx(in.view);
 mgNeighbour[1].uvs=array<vec2f,8>(${sets('dpdy')});mgNeighbour[1].world=in.view+dpdy(in.view);
`
}

/** The tile the fragment's pick asks of the program's texture reads, or none. */
function requestOf(p: SurfaceProgram) {
  const { compiled } = p
  if (!compiled.reads) return { fn: '', call: '0u' }
  const fn = `blendGraphAsk${compiled.suffix}`
  const loop = requestLoopFn({
    head: `fn ${fn}(in:VSOut,ctx:MgContext,g:${compiled.values})->u32`,
    pos: 'in.position.xy',
    word: 'uni.feedback',
    choices: `${compiled.reads}u`,
    pick: (pick, missing) => `${compiled.ask}(ctx,g,${pick},${missing})`,
  })
  return { fn: `${loop}\n`, call: `${fn}(in,ctx,g)` }
}

/** The function that evaluates the program `p` at the fragment of the item whose values begin at `first`. */
function programWgsl(p: SurfaceProgram, lobes: boolean) {
  const { compiled } = p
  const request = requestOf(p)
  return `${request.fn}fn blendGraph${compiled.suffix}(in:VSOut,first:u32)->BlendGraph{
 var out:BlendGraph;
 let g=mgLoad${compiled.suffix}(first);
${contextOf(p, lobes)}${neighboursOf(p, lobes)} out.id=${p.id}u;
 out.rgb=saturate(${outputOf(p, 'baseColor')});
 out.opacity=saturate(${outputOf(p, 'opacity')});
 out.emissive=max(${outputOf(p, 'emissive')},vec3f(0.0));
 out.metal=saturate(${outputOf(p, 'metallic')});
 out.rough=saturate(${outputOf(p, 'roughness')});
 out.ao=saturate(${outputOf(p, 'ambientOcclusion')});
${
  compiled.functions.normal
    ? ` out.normal=${outputOf(p, 'normal')};out.flags|=${GRAPH_FLAG.normal}u;\n`
    : ''
}${
    compiled.functions.subsurfaceColor
      ? ` out.thin=clamp(${outputOf(p, 'subsurfaceColor')},vec3f(0.0),vec3f(1.0));out.flags|=${GRAPH_FLAG.thin}u;\n`
      : ''
  } out.request=${request.call};
 return out;
}`
}

/**
 * The declarations of the programs `programs` — the distinct programs of the transparent items'
 * graphs, compiled for the blend (`programOf`, `kind` blend) —, in a module whose programs are
 * `lobes` (a second texture set carried) or not. `blendGraphEval(in)` is a fragment's
 * `BlendGraph`: `id` zero for an item with no graph.
 */
export function blendGraphs(programs: readonly SurfaceProgram[], lobes: boolean): BlendGraphs {
  const key = `${programs.map((p) => p.compiled.hash).join(',')}:${lobes}`
  const binding = BLEND_BINDINGS.material
  const cases = programs
    .map((p) => `  case ${p.id}u:{return blendGraph${p.compiled.suffix}(in,first);}`)
    .join('\n')
  const text = `diagnostic(off,derivative_uniformity);
/** What a fragment's graph gives: its outputs, the tile its textures ask and, in \`flags\`, whether it
 *  wires a normal (in tangent space) and a thin transmission colour. */
struct BlendGraph{id:u32,rgb:vec3f,opacity:f32,emissive:vec3f,metal:f32,rough:f32,ao:f32,normal:vec3f,thin:vec3f,flags:u32,request:u32,}
/** The record's word of the surface's graph: the first texel of its values plus one, zero without. */
fn materialGraphOf(word:u32)->u32{return materialTableRecord(word&${MATERIAL_RANK_MASK}u,${GRAPH_TEXEL}u).${GRAPH_LANE};}
${programs.map((p) => programWgsl(p, lobes)).join('\n')}
fn blendGraphEval(in:VSOut)->BlendGraph{
 var none:BlendGraph;
 let word=materialGraphOf(in.material);
 if(word==0u){return none;}
 let first=word-1u;
 switch(materialTableRecord(first/${MATERIAL_RECORD_TEXELS}u,first%${MATERIAL_RECORD_TEXELS}u).x){
${cases}
  default:{return none;}
 }
}`
  return {
    key,
    decl: wgslBlock(
      `blendGraphs(${key})`,
      [
        unitOrZero,
        materialTableWgsl(binding),
        ...programs.flatMap((p) => [p.compiled.wgsl, graphLoadWgsl(p.compiled, binding)]),
      ],
      text,
    ),
  }
}
