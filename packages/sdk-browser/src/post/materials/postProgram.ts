import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import {
  blendableOf,
  UNDRAWN_LOCATIONS,
  type BlendableLocation,
} from '../../../../sdk-core/src/world/material/postProcessMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { compileGraph, type CompiledGraph } from '../../materials/graph/compile.ts'
import {
  compileKept,
  isRefusal,
  refuseGraph,
  type GraphRefusal,
} from '../../materials/graph/kept.ts'
import { GRAPH_CONTEXT, outputCall } from '../../materials/graph/program.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { COLOR_SAMPLE } from '../../lighting/lightFunction/renderWgsl.ts'
import { POST_BINDINGS as B, POST_GIVEN } from './postLayout.ts'
import { POST_MATERIAL_ENTRY, POST_SCENE_WGSL } from './postWgsl.ts'

/** A post-process material compiled: the text of its program, the layout of the values its graph reads, and whether it follows the clock. */
export interface PostProgram {
  /** Tells one program from another: the module's text. */
  readonly key: string
  readonly wgsl: string
  /** The graph, none for a material with no graph (it gives its plain colour and opacity). */
  readonly graph: CompiledGraph | undefined
  /** The bytes of the material's uniform (`POST_GIVEN`, then the graph's values). */
  readonly bytes: number
  /** Whether the graph reads the time: the image is drawn again at each frame. */
  readonly animated: boolean
}

/** What the fragment stage computes for a pixel, from the material's colour and opacity: the graph's outputs, or the plain ones. */
function bodyOf(graph: CompiledGraph | undefined) {
  if (!graph) return 'let raw=given.plain.rgb;\n let opacity=given.plain.a;'
  const outputs = { functions: graph.functions }
  return `let raw=${outputCall(outputs, 'emissive', 'given.values')};\n let opacity=${outputCall(outputs, 'opacity', 'given.values')};`
}

/** The module of a post-process material: the frame's scene reads and the fragment stage, which draws the pixel the material gives where
 *  its stencil test passes (the pixel it replaces where it does not) and meets it by the blend the material's flags say. */
function moduleOf(graph: CompiledGraph | undefined) {
  const values = graph ? `,values:${graph.values}` : ''
  const text = `struct PpGiven{head:vec4f,plain:vec4f,flags:vec4u${values},}
@group(0) @binding(${B.given}) var<uniform> given:PpGiven;
@fragment fn ${POST_MATERIAL_ENTRY}(@builtin(position) at:vec4f)->@location(0) vec4f{
 let pixel=vec2i(at.xy);
 let uv=at.xy/view.image.xy;
 let before=textureLoad(ppInput,pixel,0);
 if(given.flags.y!=0u){
  let held=textureLoad(ppCustomStencil,vec2i(ppUv(uv,ppCustomArea())*view.custom.xy),0).g;
  if(!ppStencilPasses(held,given.flags.z,given.flags.w)){return before;}
 }
 var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(uv,uv,uv,uv,uv,uv,uv,uv);
 ctx.vertexColor=vec4f(1.0);
 ctx.time=given.head.x;
 ctx.realTime=given.head.y;
 ${bodyOf(graph)}
 let finite=select(vec3f(0.0),raw,raw==raw);
 let lit=finite*view.head.x;
 switch given.flags.x {
  case 0u:{return vec4f(lit,opacity);}
  case 1u:{return vec4f(lit*opacity+before.rgb*(1.0-opacity),before.a);}
  case 2u:{return vec4f(lit+before.rgb,before.a);}
  case 3u:{return vec4f(finite*before.rgb,before.a);}
  case 4u:{return vec4f(lit+before.rgb*(1.0-opacity),opacity+before.a*(1.0-opacity));}
  case 5u:{return vec4f(before.rgb*(1.0-opacity),before.a*(1.0-opacity));}
  default:{return vec4f(lit,before.a);}
 }
}`
  return wgslProgram(text, [
    GRAPH_CONTEXT,
    POST_SCENE_WGSL,
    FULLSCREEN_VERTEX,
    ...(graph ? [graph.wgsl] : []),
  ])
}

/** The program of a material with no graph: one for all of them. */
const PLAIN: PostProgram = (() => {
  const wgsl = moduleOf(undefined)
  return { key: wgsl, wgsl, graph: undefined, bytes: POST_GIVEN.words * 4, animated: false }
})()

/** The program of `graph`, refused (naming the node or the read) where a pass of the image cannot evaluate it: a graph that reads a
 *  texture needs the material atlas, which this pass does not bind. */
function programOfGraph(graph: MaterialGraph): PostProgram {
  const compiled = compileGraph(graph, {
    sample: COLOR_SAMPLE,
    derivatives: 'screen',
    vertexColor: true,
  })
  if (compiled.uses.textures || compiled.uses.sparseVolumes)
    throw graphError('a post-process material does not read a texture')
  const wgsl = moduleOf(compiled)
  return {
    key: wgsl,
    wgsl,
    graph: compiled,
    bytes: POST_GIVEN.words * 4 + compiled.slots.bytes,
    animated: compiled.uses.time,
  }
}

/** The program of `material`, kept while its graph keeps its shape; none for a material that is not drawable (a refusal, named with the
 *  others by `takeGraphRefusals`). */
export function postProgramOf(material: Material): PostProgram | GraphRefusal {
  const graph = material.graph as MaterialGraph | undefined
  return graph ? compileKept(graph, 'postProcess', () => programOfGraph(graph)) : PLAIN
}

/** The program of `material` where it is drawable, else none. */
export function usablePostProgram(material: Material) {
  const made = postProgramOf(material)
  return isRefusal(made) ? undefined : made
}

/** The location each material was last named for, so a refused place is said once, not at each image. */
const named = new WeakMap<Material, BlendableLocation>()

/** Names, once each, the materials that join the image at a place it does not offer (`UNDRAWN_LOCATIONS`): they are never drawn. */
export function nameUndrawnBlendables(entries: readonly { readonly material: Material }[]) {
  for (const { material } of entries) {
    const { location } = blendableOf(material)
    if (!UNDRAWN_LOCATIONS.includes(location)) named.delete(material)
    else if (named.get(material) !== location) {
      named.set(material, location)
      refuseGraph(new Error(`BLENDABLE_LOCATION_NOT_DRAWN:${location}`))
    }
  }
}
