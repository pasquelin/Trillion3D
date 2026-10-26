import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { graphLobes, heldOutputs, outputCall } from '../materials/graph/outputsOf.ts'
import { altSetOf } from '../materials/graph/state.ts'
import {
  isProgram,
  programOf,
  programsOf,
  type GraphSurface,
  type SurfaceProgram,
} from '../materials/graph/surfaceProgram.ts'
import { VIEW_FORWARD_WGSL } from '../materials/graph/program.ts'
import {
  GRAPH_SHADING_MODELS,
  THIN_TRANSLUCENT_OUTPUTS,
  WATER_OUTPUTS,
} from '../../../sdk-core/src/world/material/graph/outputs.ts'
import { shadingFlagsOfNumber } from '../materials/surface/pixelModel.ts'
import { blendGraphFlagsWgsl } from './graphFlagsWgsl.ts'
import { PHYSICAL_MAP_FIELDS } from '../visibility/materialType.ts'
import { graphLoadWgsl } from '../materials/graph/tableValues.ts'
import { MATERIAL_RECORD } from '../materials/table/materialLayout.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { requestLoopFn } from '../materials/virtual/requestWgsl.ts'
import { FACING_MATERIAL_MASK } from './facing.ts'
import { WORDS } from './vertexReadsWgsl.ts'

/**
 * THE GRAPHS OF THE TRANSPARENT PASS: the blend module holds the functions of every program of the
 * graphs its items wear (`blendGraphs`) and evaluates the program of each fragment's item once,
 * among the screen derivatives (`blendGrads`, `shaderSurface.ts`), before any fragment is rejected:
 * the outputs, held as a shader holds them (`heldOutputs`), the lobes of a lobed program
 * (`graphLobes`) and the tile its textures ask. A texture read's footprint is found at the contexts a
 * pixel to the right and a pixel below (`neighboursOf`), which the screen derivatives of the context
 * give. The item's record names its values in the material table (`graph`) and the first of them,
 * its header, the program (`id`): a switch picks the program's function. The items of one quad share
 * a primitive, so the derivatives the switch takes are those of its own pixels; the functions that
 * take them say so (`derivative_uniformity` off), no other.
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
  /** Whether a program wires the shading model: `BlendGraph.model` exists (`modelOf`). */
  readonly model: boolean
}

/** The bits of `BlendGraph.flags`: the graph wires a normal, a thin transmission colour, a refraction, the water's volume, a thin
 *  translucent layer, a pixel depth offset, a shading model. */
export const GRAPH_FLAG = {
  normal: 1,
  thin: 2,
  refraction: 4,
  water: 8,
  layer: 16,
  depth: 32,
  model: 64,
} as const

/** The outputs of the water's volume (`WATER_OUTPUTS`) a program of the module wires: the module's
 *  `BlendGraph` then holds their values (`waterOf`). */
export const waterOf = (programs: readonly SurfaceProgram[]) =>
  programs.some((p) => WATER_OUTPUTS.some((name) => p.compiled.functions[name]))

/** Whether a program of the module wires a thin translucent output (`THIN_TRANSLUCENT_OUTPUTS`): the
 *  module's `BlendGraph` then holds the layer's colour and coverage. */
export const layerOf = (programs: readonly SurfaceProgram[]) =>
  programs.some((p) => THIN_TRANSLUCENT_OUTPUTS.some((name) => p.compiled.functions[name]))

/** Whether a program of the module wires a pixel depth offset: the `BlendGraph` then holds it, and the
 *  responsiveness pass writes the depth it moves the pixel to (`pushedDepthWgsl.ts`). */
export const depthOf = (programs: readonly SurfaceProgram[]) =>
  programs.some((p) => p.compiled.functions.pixelDepthOffset)

/** Whether a program of the module wires the shading model: the module's `BlendGraph` then holds the model the pixel picks, and
 *  `blendGraphFlags` carries it to the lighting. */
const modelOf = (programs: readonly SurfaceProgram[]) =>
  programs.some((p) => p.compiled.functions.shadingModel)

/** What a module's `BlendGraph` holds beyond the outputs every program gives. */
interface Extras {
  readonly water: boolean
  readonly layer: boolean
  readonly depth: boolean
}

/** The record's word of a surface's graph, one lane of one texel (`materialGraphOf`). */
const GRAPH_TEXEL = MATERIAL_RECORD.at.graph >> 2
const GRAPH_LANE = 'xyzw'[MATERIAL_RECORD.at.graph & 3]

/** The set past the first a lobed program carries (`in.uv.zw`) stands for every one the graph reads
 *  past it, as `set` says: the one, 0 where it reads none. */
const carried = (alt: number, lobes: boolean, set: number) =>
  lobes && alt && set === alt ? 'in.uv.zw' : 'in.uv.xy'

/** The context of the fragment: the sets the graph reads, the world, the view and the clock. */
function contextOf({ compiled }: SurfaceProgram, lobes: boolean) {
  const alt = altSetOf(compiled.uses.sets)
  const sets = Array.from({ length: 8 }, (_, set) => carried(alt, lobes, set))
  return ` var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(${sets.join(',')});
 ctx.world=in.view;ctx.eye=uni.eye.xyz;ctx.origin=vec3f(0.0);
 ctx.viewForward=mgViewForward(uni.viewProj,uni.eye.xyz,in.view);
 ctx.vertexNormal=unitOrZero(in.normal.xyz);ctx.pixelNormal=ctx.vertexNormal;
 ctx.time=uni.time;ctx.realTime=uni.realTime;
`
}

/** The contexts a pixel to the right and a pixel below are read in, for the footprint of a texture
 *  read (\`mgNeighbour\`): the sets and the position moved by their screen derivatives, taken here,
 *  before any branch that is not the quad's, so that no program takes one of its own. */
function neighboursOf({ compiled }: SurfaceProgram, lobes: boolean) {
  if (!compiled.uses.textures) return ''
  const alt = altSetOf(compiled.uses.sets)
  const sets = (step: 'dpdx' | 'dpdy') =>
    Array.from({ length: 8 }, (_, set) => {
      const own = carried(alt, lobes, set)
      return `${own}+${step}(${own})`
    }).join(',')
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

/** The lines of a program's function that set what the graph wires beyond the outputs held: the
 *  normal, the thin transmission, the refraction and, in a lobed module, the lobes. */
function wired(
  { compiled }: SurfaceProgram,
  lobes: boolean,
  { water, layer, depth }: Extras,
  held: ReturnType<typeof heldOutputs>,
) {
  const call = outputCall(compiled, 'ctx,g')
  const { functions } = compiled
  const lines: string[] = []
  if (functions.normal) lines.push(`out.normal=${call('normal')};out.flags|=${GRAPH_FLAG.normal}u;`)
  if (functions.subsurfaceColor)
    lines.push(
      `out.thin=clamp(${call('subsurfaceColor')},vec3f(0.0),vec3f(1.0));out.flags|=${GRAPH_FLAG.thin}u;`,
    )
  if (functions.refraction)
    lines.push(`out.refraction=${call('refraction')};out.flags|=${GRAPH_FLAG.refraction}u;`)
  if (water && WATER_OUTPUTS.some((name) => functions[name]))
    lines.push(
      `out.scatter=max(${functions.scatteringCoefficients ? call('scatteringCoefficients') : 'vec3f(0.0)'},vec3f(0.0));out.absorb=max(${functions.absorptionCoefficients ? call('absorptionCoefficients') : 'vec3f(0.0)'},vec3f(0.0));out.phaseG=clamp(${functions.phaseG ? call('phaseG') : '0.0'},-1.0,1.0);out.colorScale=max(${functions.colorScaleBehindWater ? call('colorScaleBehindWater') : 'vec3f(1.0)'},vec3f(0.0));out.flags|=${GRAPH_FLAG.water}u;`,
    )
  if (layer && THIN_TRANSLUCENT_OUTPUTS.some((name) => functions[name]))
    lines.push(
      `out.layer=clamp(${functions.transmittanceColor ? call('transmittanceColor') : 'vec3f(0.5)'},vec3f(0.0),vec3f(1.0));out.coverage=clamp(${functions.surfaceCoverage ? call('surfaceCoverage') : '1.0'},0.0,1.0);out.flags|=${GRAPH_FLAG.layer}u;`,
    )
  if (functions.shadingModel)
    lines.push(
      `out.model=i32(round(${call('shadingModel')}));out.flags|=${GRAPH_FLAG.model}u;`,
      // An unlit pixel shows its emission alone (the opaque resolve's rule, `heldOutputs`).
      `if(out.model==${GRAPH_SHADING_MODELS.unlit}){out.rgb=${held.emission};out.emissive=vec3f(0.0);out.metal=0.0;out.ao=1.0;}`,
    )
  if (depth && functions.pixelDepthOffset)
    lines.push(`out.depth=${call('pixelDepthOffset')};out.flags|=${GRAPH_FLAG.depth}u;`)
  const values = lobes ? graphLobes(compiled, call) : undefined
  if (values)
    lines.push(
      values.prelude,
      `out.lobes=${values.lobes};out.law=${values.law};out.tangent=${values.tangent};`,
    )
  return lines.map((line) => ` ${line}\n`).join('')
}

/** The function that evaluates the program `p` at the fragment of the item whose values begin at `first`. */
function programWgsl(p: SurfaceProgram, lobes: boolean, extras: Extras) {
  const { compiled } = p
  const request = requestOf(p)
  const held = heldOutputs(compiled, outputCall(compiled, 'ctx,g'))
  return `${request.fn}@diagnostic(off,derivative_uniformity) fn blendGraph${compiled.suffix}(in:VSOut,first:u32)->BlendGraph{
 var out:BlendGraph;
 let g=mgLoad${compiled.suffix}(first);
${contextOf(p, lobes)}${neighboursOf(p, lobes)} out.id=${p.id}u;
 out.rgb=${held.rgb};
 out.opacity=${held.opacity};
 out.emissive=${held.emissive};
 out.metal=${held.metallic};
 out.rough=${held.roughness};
 out.ao=${held.occlusion};
 out.specular=${held.specular};
${wired(p, lobes, extras, held)} out.request=${request.call};
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
  const extras = { water: waterOf(programs), layer: layerOf(programs), depth: depthOf(programs) }
  const { water, layer, depth } = extras
  const model = modelOf(programs)
  const key = `${programs.map((p) => p.compiled.hash).join(',')}:${lobes}${water ? ':water' : ''}${layer ? ':layer' : ''}${depth ? ':depth' : ''}${model ? ':model' : ''}`
  const binding = BLEND_BINDINGS.material
  const cases = programs
    .map((p) => `  case ${p.id}u:{return blendGraph${p.compiled.suffix}(in,first);}`)
    .join('\n')
  const text = `/** What a fragment's graph gives: its outputs, the tile its textures ask, in \`flags\` whether it
 *  wires a normal (in tangent space), a thin transmission colour and a refraction, and, in a lobed
 *  module, the values of its lobes' record (\`law\` zero where it computes none). */
struct BlendGraph{id:u32,rgb:vec3f,opacity:f32,emissive:vec3f,metal:f32,rough:f32,ao:f32,specular:f32,normal:vec3f,thin:vec3f,flags:u32,request:u32,lobes:vec4f,tangent:vec3f,law:u32,refraction:f32,${model ? 'model:i32,' : ''}${water ? 'scatter:vec3f,absorb:vec3f,phaseG:f32,colorScale:vec3f,' : ''}${layer ? 'layer:vec3f,coverage:f32,' : ''}${depth ? 'depth:f32,' : ''}}
${
  lobes
    ? `/** The lobes the item's graph computes, set in the fragment's lobe record in place of the record's own
 *  (\`physicalWgsl.ts\`), where the item carries a lobe extension (\`physicalOn\`). */
fn blendGraphLobes(g:BlendGraph){
 if(physicalOn&&g.law!=0u){physicalRecord.lobes=g.lobes;physicalRecord.maps=array<u32,${PHYSICAL_MAP_FIELDS.length}>();physicalRecord.law=g.law;physicalTangent=g.tangent;}
}
`
    : ''
}${model ? blendGraphFlagsWgsl(GRAPH_FLAG.model) : 'fn blendGraphFlags(flags:u32,g:BlendGraph)->u32{return flags;}\n'}/** The record's word of the surface's graph: the first texel of its values plus one, zero without.
 *  \`word\` is the item's material word, whose facing mode (\`FACING_SHIFT\`) rides above its rank. */
fn materialGraphOf(word:u32)->u32{return materialTableRecord(word&${FACING_MATERIAL_MASK}u,${GRAPH_TEXEL}u).${GRAPH_LANE};}
${programs.map((p) => programWgsl(p, lobes, extras)).join('\n')}
@diagnostic(off,derivative_uniformity) fn blendGraphEval(in:VSOut)->BlendGraph{
 var none:BlendGraph;
 let word=materialGraphOf(in.${WORDS.material});
 if(word==0u){return none;}
 let first=word-1u;
 switch(materialGraphHead(word).x){
${cases}
  default:{return none;}
 }
}`
  return {
    key,
    model,
    decl: wgslBlock(
      `blendGraphs(${key})`,
      [
        unitOrZero,
        ...(model ? [shadingFlagsOfNumber] : []),
        VIEW_FORWARD_WGSL,
        materialTableWgsl(binding),
        ...programs.flatMap((p) => [p.compiled.wgsl, graphLoadWgsl(p.compiled, binding)]),
      ],
      text,
    ),
  }
}

/** The distinct programs of the graphs the surfaces of `items` wear for the transparent pass, by id:
 *  what the modules hold the functions of (`blendGraphs`). */
export function graphProgramsOf(items: readonly { readonly surface: GraphSurface }[]) {
  const found = new Map<number, SurfaceProgram>()
  for (const { surface } of items) {
    const program = programOf(surface)
    if (isProgram(program) && program.kind === 'blend') found.set(program.id, program)
  }
  return [...found.values()].sort((a, b) => a.id - b.id)
}

/** Whether a program of the transparent pass among `ids` — those a pass's modules hold the functions of
 *  (`BlendPipelines.graphs`) — reads the time: its fragments change from one image to the next with
 *  nothing else moving, so the image is never held. */
export const blendGraphsAnimated = (ids: readonly number[] | undefined) =>
  !!ids?.some((id) => programsOf('blend')[id - 1]?.compiled.uses.time)
