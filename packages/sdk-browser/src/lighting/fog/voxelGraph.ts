import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { VOLUME_OUTPUT_LIMIT } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import type { ResolvedFogVolume } from '../../../../sdk-core/src/scene/volume/contracts.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { compileGraph, type CompiledGraph } from '../../materials/graph/compile.ts'
import { fallbackOf, GRAPH_CONTEXT } from '../../materials/graph/program.ts'
import { compileKept, isRefusal } from '../../materials/graph/kept.ts'
import {
  colorSampleWgsl,
  SHADOW_TILE_POOL_WGSL,
  tileDeclarations,
} from '../../materials/virtual/wgsl.ts'
import { FOG_BINDING } from './bindings.ts'

/**
 * THE GRAPHS OF THE VOXELISED OBJECTS (`SceneFogVolume.graph`): an object that wears a graph of the
 * volume domain gives, at the centre of each cell it covers, the albedo (`baseColor`, held to
 * [0, 1]), the extinction (`subsurfaceColor`'s red channel, from 0 to the limit a half float holds)
 * and the emissive light (`emissive`, the same limits) the graph computes, in place of its material's
 * numbers: the outputs the voxelisation of the reference reads. Its context is the cell's centre in
 * the world, the camera, the object's origin and the time; it has no texture coordinate and no
 * normal. A texture it reads is read through the colour atlas, at the footprint of the cell found at
 * the cells beside (`mgNeighbour`).
 *
 * The programs of the objects of an image — the distinct graphs, by the text they compile to — are
 * the functions of one voxelisation program (`voxelGraphWgsl`), made when the set changes
 * (`FogGraphResources.programOf`); an object names its program by its place in the set and its values
 * by their texel in one buffer (`GraphValues`), which the program reads like the material table.
 * An object whose graph does not compile adds what its material gives.
 */
export interface VolumeProgram {
  readonly hash: string
  readonly compiled: CompiledGraph
  readonly graph: MaterialGraph
}

/** The graphs of an image: the programs in the order their objects name them, and whether one reads a texture. */
export interface VoxelGraphSet {
  readonly key: string
  readonly programs: readonly VolumeProgram[]
  readonly textured: boolean
}

/** The colour atlas's resources the voxelisation of the graphs that read a texture binds: its pools, its
 *  page table and the sampler they are read through. */
export interface FogAtlas {
  readonly views: readonly GPUTextureView[]
  readonly pages: GPUBuffer
  readonly sampler: GPUSampler
}

/** The atlas's bindings in the program of the graphs that read a texture. */
const FOG_ATLAS = {
  lanes: [FOG_BINDING.graphPool0, FOG_BINDING.graphPool1, FOG_BINDING.graphPool2],
  pages: FOG_BINDING.graphPages,
}

/** The program a graph compiles to for the voxelisation, once for each shape of the graph; none for
 *  a graph that does not compile (named with the others). */
function volumeProgramOf(graph: MaterialGraph): VolumeProgram | undefined {
  const made = compileKept(graph, 'volume', () => {
    const compiled = compileGraph(graph, {
      sample: colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      derivatives: 'neighbours',
      named: true,
    })
    return { hash: compiled.hash, graph, compiled }
  })
  return isRefusal(made) ? undefined : made
}

/** Whether two programs are one: the same whole text, no hash standing for it. */
const sameProgram = (a: VolumeProgram, b: VolumeProgram) => a.compiled.key === b.compiled.key

/** The distinct programs the graphs of `objects` compile to, in a stable order; none where no
 *  object wears a graph that compiles. */
export function voxelGraphSet(objects: Iterable<ResolvedFogVolume>): VoxelGraphSet | undefined {
  const found = new Map<string, VolumeProgram>()
  for (const { graph } of objects) {
    const program = graph && volumeProgramOf(graph)
    if (program && !found.has(program.compiled.key)) found.set(program.compiled.key, program)
  }
  if (!found.size) return undefined
  const programs = [...found.values()].sort((a, b) => (a.hash < b.hash ? -1 : 1))
  return {
    key: programs.map((p) => p.hash).join(','),
    programs,
    textured: programs.some((p) => p.compiled.uses.textures),
  }
}

/** The code that calls the output `name` of `p` at the cell, or its default. */
const outputOf = ({ compiled }: VolumeProgram, name: GraphOutput) => {
  const fn = compiled.functions[name]
  return fn ? `${fn}(ctx,g)` : fallbackOf(name).code
}

/** The context of the cell: its world position, the camera, the object's origin and the clock. */
const CONTEXT = ` var ctx:MgContext;
 ctx.world=position+frame.eye.xyz;ctx.eye=frame.eye.xyz;ctx.origin=object.toWorld[3].xyz+frame.eye.xyz;
 ctx.time=voxelFrame.passes.w;ctx.realTime=voxelFrame.realTime;
`

/** The function of the program `p`: the object's albedo, extinction and emissive light at the cell,
 *  read from the values at texel \`at\`. */
function programWgsl(p: VolumeProgram) {
  const { compiled: c } = p
  const vectors = Math.max(c.slots.vectors.length, 1)
  const neighbours = c.uses.textures
    ? ` mgNeighbour[0]=ctx;mgNeighbour[1]=ctx;
 mgNeighbour[0].world=right+frame.eye.xyz;mgNeighbour[1].world=below+frame.eye.xyz;
`
    : ''
  return `fn fogLoad${c.suffix}(at:u32)->${c.values}{
 var g:${c.values};
 for(var i=0u;i<${vectors}u;i++){g.v[i]=bitcast<vec4f>(voxelGraphValues[at+i]);}
 for(var i=0u;i<${c.slots.textureRows}u;i++){g.t[i]=voxelGraphValues[at+${vectors}u+i];}
 return g;
}
fn fogGraph${c.suffix}(object:FogVoxelObject,at:u32,position:vec3f,right:vec3f,below:vec3f)->FogGraphOut{
 let g=fogLoad${c.suffix}(at);
${CONTEXT}${neighbours} var out:FogGraphOut;
 out.albedo=saturate(${outputOf(p, 'baseColor')});
 out.extinction=clamp((${outputOf(p, 'subsurfaceColor')}).x,0.0,${VOLUME_OUTPUT_LIMIT}.0);
 out.emissive=clamp(${outputOf(p, 'emissive')},vec3f(0.0),vec3f(${VOLUME_OUTPUT_LIMIT}.0));
 return out;
}`
}

/**
 * The declarations of the programs of `set`: the structure of what a graph gives a cell, the
 * functions of each program and `fogGraphAt`, which an object's cell calls (the object's `graph`
 * word names the program by its place in the set, from 1, and its values by their texel). The
 * programs read the values from `voxelGraphValues` (`FOG_BINDING.graphValues`), the textures from
 * the atlas bound where the set reads one (`FOG_ATLAS`, the sampler `mapsSampler`). The voxelisation
 * lists the block with `FogVoxelObject` and the frame declared before it.
 */
export function voxelGraphWgsl(set: VoxelGraphSet): WgslDecl {
  const cases = set.programs
    .map(
      (p, at) =>
        `  case ${at + 1}u:{return fogGraph${p.compiled.suffix}(object,object.graph.y,position,right,below);}`,
    )
    .join('\n')
  const atlas = set.textured
    ? `${tileDeclarations(FOG_ATLAS, 'color')}\n@group(0) @binding(${FOG_BINDING.graphSampler}) var mapsSampler:sampler;\n`
    : ''
  return wgslBlock(
    `fogVoxelGraphs(${set.key})`,
    [GRAPH_CONTEXT, ...set.programs.map((p) => p.compiled.wgsl)],
    `@group(0) @binding(${FOG_BINDING.graphValues}) var<storage,read> voxelGraphValues:array<vec4u>;
${atlas}struct FogGraphOut{albedo:vec3f,extinction:f32,emissive:vec3f,}
${set.programs.map(programWgsl).join('\n')}
fn fogGraphAt(object:FogVoxelObject,position:vec3f,right:vec3f,below:vec3f)->FogGraphOut{
 switch object.graph.x {
${cases}
  default:{return FogGraphOut(vec3f(0.0),0.0,vec3f(0.0));}
 }
}`,
  )
}

/**
 * The values of the objects' graphs, as the buffer of the voxelisation reads them: each object's
 * block — the vectors of its parameters, then its texture words, each texel four words — one after
 * the other. `add` writes an object's block and gives its `graph` word: its program's place in the
 * set (from 1, zero where the program is none of the set's) and the block's first texel.
 */
export function createGraphValues() {
  let words = new Uint32Array(64)
  let used = 0
  return {
    /** The words written, whole texels. */
    get words() {
      return words.subarray(0, used)
    },
    reset() {
      used = 0
    },
    add(
      object: ResolvedFogVolume,
      set: VoxelGraphSet,
      slotOf: (texture: Texture) => number | undefined,
    ): [number, number] {
      const program = object.graph && volumeProgramOf(object.graph)
      const ordinal = program ? set.programs.findIndex((p) => sameProgram(p, program)) + 1 : 0
      if (!program || !ordinal) return [0, 0]
      const { slots } = program.compiled
      const size = (slots.bytes / 4) | 0
      words = resized(words, used + size)
      const texel = used / 4
      slots.fill(program.graph, words.buffer, used * 4, (texture) => slotOf(texture) ?? 0)
      used += size
      return [ordinal, texel]
    },
  }
}
