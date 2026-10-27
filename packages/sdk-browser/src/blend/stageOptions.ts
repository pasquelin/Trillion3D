import { type ContractKey, variantLabel } from '../lighting/deferred/contractCuts.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { BLEND_CONTACT_SCENE_WGSL, SET_CONTACT_ASKED } from './contactSceneWgsl.ts'
import { BLEND_CHANNELS_WGSL } from './vertexReadsWgsl.ts'
import { type VertexReads, cloudVertexText, type CloudVertexText } from './cloudVertexText.ts'
import { blendGraphs, depthOf, layerOf } from './graphWgsl.ts'
import { blendSurfaceWgsl } from './shaderSurface.ts'

/**
 * WHAT A FRAGMENT STAGE OF THE BLEND MODULE IS MADE WITH, one object for every stage (the blend stage, the transmissive stages,
 * the water's), made once from the scene (`stageOptions`): the key its lights are cut by (`lit`, `translucentLitKey`: whether
 * the lights test the lighting channels, whether the contact shadows' asked ray is held and whether the surfaces carry a lobe
 * follow from it, `stageLobes`); whether the items wear a graph
 * (`graphs`), a graph pushes the depth (`depth`) or wires a layer (`layer`); the words of the clouds per vertex (`shade`);
 * whether surfaces ask for shadow reads of their own (`marks`). The block name of a stage is derived from it (`stageLabel`), so
 * two stages of one text are one block.
 */
export interface StageOptions {
  readonly lit: Partial<ContractKey>
  readonly graphs: boolean
  readonly shade: CloudVertexText
  readonly marks: boolean
  readonly depth: boolean
  readonly layer: boolean
}

/** The options of a stage whose lights are cut by `lit` (`translucentLitKey`), over the graph `programs` the items wear, the
 *  vertex `reads` of the module and whether surfaces ask for shadow reads of their own (`marks`). */
export const stageOptions = (
  lit: Partial<ContractKey>,
  programs: readonly SurfaceProgram[] | undefined,
  reads: VertexReads,
  marks: boolean,
): StageOptions => {
  const graphs = !!programs?.length
  return {
    lit,
    graphs,
    shade: cloudVertexText(reads),
    marks,
    depth: graphs && depthOf(programs),
    layer: graphs && layerOf(programs),
  }
}

/** Whether the surfaces of a stage carry a lobe: its lights' key says so. */
export const stageLobes = ({ lit }: StageOptions) => !lit.lobeless

/** The surface block of a stage over the graph `programs` the items wear (none: no graph), lobed as the stage is (`lobes`). */
export const stageSurface = (lobes: boolean, programs?: readonly SurfaceProgram[]) =>
  blendSurfaceWgsl(lobes, programs?.length ? blendGraphs(programs, lobes) : undefined)

/** The part of a stage's block name that says which pieces its text holds: the lights' key and the options past it. */
export const stageLabel = (o: StageOptions) =>
  `${variantLabel(o.lit)}, ${o.graphs}${o.shade.key}${o.marks ? ', surface shadow marks' : ''}${o.depth ? ', pushed depth' : ''}${o.layer ? ', layer' : ''}`

/** The statements that set, before a translucent layer is lit, whether its diffuse light is the rough diffuse (`shadingRoughDiffuse`,
 *  `BlendView.roughDiffuse`; a cloth then takes Lambert's, `setCloth`) and whether the visibility of its specular lobes is the exact one
 *  (`shadingAccurate`, `BlendView.shadingAccurate`). */
const SET_SHADING = [
  'roughDiffuse=uni.roughDiffuse!=0u;',
  'shadingAccurate=uni.shadingAccurate!=0u;',
]
/** The statement that sets the lighting channels of the layer's item, from its triangle word (`blendChannelsOf`). */
const SET_SURFACE_CHANNELS = 'surfaceChannels=blendChannelsOf(in);'

/** The statements every lit stage runs before it lights a layer, `indent` deep: the rough diffuse's switch, the ask of the
 *  contact shadows' ray where the lights hold the ray (`SET_CONTACT_ASKED`; a surface whose material asks not, water among them,
 *  casts none), and the item's lighting channels where the lights test them. */
export const stagePrologue = ({ lit }: StageOptions, indent: string) =>
  [
    ...SET_SHADING,
    ...(lit.contactless ? [] : [SET_CONTACT_ASKED]),
    ...(lit.channelless ? [] : [SET_SURFACE_CHANNELS]),
  ].join(`\n${indent}`)

/** The blocks the statements of `stagePrologue` read: the contact shadows' reads where the lights hold the ray, the channels of the item
 *  where the lights test them. */
export const stageImports = ({ lit }: StageOptions) => [
  ...(lit.contactless ? [] : [BLEND_CONTACT_SCENE_WGSL]),
  ...(lit.channelless ? [] : [BLEND_CHANNELS_WGSL]),
]
