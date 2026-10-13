/**
 * WHAT A NODE, A SURFACE OR A TEXTURE IS, read the same whichever library built it: the engine's
 * graph says it by its `kind` and its `family` (`packages/sdk-browser/src/host/graph/kinds.ts`) — its meshes, the core's, by
 * the flags `isMesh` and `isInstancedMesh` —, the loader the scenes are compared with by its
 * library's flags and type names — named here, for the comparison alone (`scenes.fixture.ts`).
 */
import * as THREE from 'three'

type Fields = Record<string, unknown>

/** The library's flag of each node kind, the most specific first. */
const NODE_FLAGS = [
  ['isInstancedMesh', 'instancedMesh'],
  ['isMesh', 'mesh'],
  ['isDirectionalLight', 'directional'],
  ['isPointLight', 'point'],
  ['isSpotLight', 'spot'],
  ['isAmbientLight', 'ambient'],
  ['isRectAreaLight', 'rectArea'],
  ['isLightProbe', 'probe'],
  ['isCamera', 'camera'],
  ['isScene', 'scene'],
  ['isGroup', 'group'],
] as const
/** The library's type name of each surface family. */
const FAMILIES: Record<string, string> = {
  MeshBasicMaterial: 'basic',
  MeshStandardMaterial: 'standard',
  MeshPhysicalMaterial: 'physical',
  MeshLambertMaterial: 'lambert',
  MeshPhongMaterial: 'phong',
  MeshToonMaterial: 'toon',
  MeshNormalMaterial: 'normal',
  MeshMatcapMaterial: 'matcap',
  MeshDepthMaterial: 'depth',
}

/** The node's kind: `'mesh'`, `'spot'`, `'camera'`… or `'node'`. */
export const nodeKind = (node: Fields): string =>
  typeof node.kind === 'string'
    ? node.kind
    : (NODE_FLAGS.find(([flag]) => node[flag]) ?? ['', 'node'])[1]

/** Whether the node is drawn, lit by, or an eye. */
export const isDrawnKind = (kind: string) => kind === 'mesh' || kind === 'instancedMesh'
export const isLightKind = (kind: string) =>
  ['directional', 'point', 'spot', 'ambient', 'rectArea', 'probe'].includes(kind)

/** The surface's family. */
export const surfaceFamily = (surface: Fields) =>
  (surface.family as string | undefined) ?? FAMILIES[surface.type as string]

/** A texture's kind — `'texture'`, or `'texels'` for raw texels —, `undefined` for anything else. */
export function textureKind(value: Fields | null | undefined) {
  if (!value) return undefined
  if (value.kind === 'texture' || value.kind === 'texels') return value.kind
  if (value.isTexture) return value.isDataTexture || value.layout === 'data' ? 'texels' : 'texture'
  return undefined
}

/** Whether the value is a vertex attribute, owning its storage or viewing a shared one. */
export const isAttribute = (value: Fields | null | undefined) =>
  !!value &&
  (value.kind === 'attribute' ||
    value.kind === 'interleavedAttribute' ||
    !!value.isBufferAttribute ||
    !!value.isInterleavedBufferAttribute)

/** The reference's sampler numbers in the engine's words: what both sides are compared in. */
const WORDS = new Map<unknown, string>([
  [THREE.RepeatWrapping, 'repeat'],
  [THREE.ClampToEdgeWrapping, 'clamp'],
  [THREE.MirroredRepeatWrapping, 'mirror'],
  [THREE.NearestFilter, 'nearest'],
  [THREE.LinearFilter, 'linear'],
  [THREE.NearestMipmapNearestFilter, 'nearestMipNearest'],
  [THREE.NearestMipmapLinearFilter, 'nearestMipLinear'],
  [THREE.LinearMipmapNearestFilter, 'linearMipNearest'],
  [THREE.LinearMipmapLinearFilter, 'linearMipLinear'],
])
const word = (value: unknown) => WORDS.get(value) ?? value

/** A texture's fields in the engine's words, whichever side built it: an engine record carries
 *  its composed transform, a reference texture composes its matrix here. */
export function textureFields(v: Fields) {
  const reference = v as unknown as THREE.Texture
  const matrix = v.transform ?? (reference.updateMatrix(), reference.matrix.elements)
  return {
    ...Object.fromEntries(
      ['name', 'channel', 'anisotropy', 'flipY', 'premultiplyAlpha', 'image'].map((key) => [
        key,
        v[key],
      ]),
    ),
    ...Object.fromEntries(
      ['wrapS', 'wrapT', 'magFilter', 'minFilter'].map((key) => [key, word(v[key])]),
    ),
    srgb: v.colorSpace === 'srgb',
    matrix: Array.from(matrix as ArrayLike<number>),
  }
}
