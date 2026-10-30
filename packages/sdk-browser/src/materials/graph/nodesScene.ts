import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { NodeKind } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import type { SceneTextureId } from '../../../../sdk-core/src/world/material/postProcessMaterial.ts'
import { coordinate } from './nodesInput.ts'
import { coerce, type Value } from './value.ts'
import type { State } from './state.ts'

type Handler = (s: State, node: GraphNode) => Value

/** The number each scene texture goes by in the post-process pass (`ppScene`, `ppSceneSize`): the reference's own numbering of the images
 *  a material reads, so a pass written for either reads the same ids. */
export const SCENE_TEXTURE_NUMBERS: Readonly<Record<SceneTextureId, number>> = {
  sceneColor: 0,
  sceneDepth: 1,
  customDepth: 13,
  postProcessInput0: 14,
  customStencil: 25,
}

/** The number of the scene texture a node names, refused outside the post-process domain, the only one that has an image to read. */
function sceneTextureOf(s: State, n: GraphNode) {
  if (s.domain !== 'postProcess')
    throw graphError(`${n.kind} has no value in the ${s.domain} domain`, { node: n.id })
  return SCENE_TEXTURE_NUMBERS[n.props.id as SceneTextureId]
}

/** An image of the pass read at the pixel's place in it: the image `id` at `uv` (the pixel's own place where not wired), bilinear
 *  where `filtered`. The colour images give their colour, the depths their distance along the view axis in all four channels, the
 *  stencil its value in all four. */
const sceneTexture: Handler = (s, n) => {
  const id = sceneTextureOf(s, n)
  const wired = s.input(n, 'uv')
  const uv = wired ? coerce(wired, 'f2') : coordinate(s, 0)
  return s.e.local('f4', `ppScene(${id}u,${uv.code},${n.props.filtered === true})`)
}

/** The size in pixels of the scene texture, or one over it. */
const sceneTextureSize: Handler = (s, n) => {
  const id = sceneTextureOf(s, n)
  return s.e.local('f2', `ppSceneSize(${id}u).${n.props.inverse === true ? 'zw' : 'xy'}`)
}

/** The scene texture nodes, by kind. */
export const SCENE_HANDLERS: Partial<Record<NodeKind, Handler>> = { sceneTexture, sceneTextureSize }
