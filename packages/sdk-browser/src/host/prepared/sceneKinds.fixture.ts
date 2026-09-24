/**
 * WHAT A NODE, A SURFACE OR A TEXTURE IS, read the same whichever library built it: the engine's
 * graph says it by its `kind` and its `family` (`../graph/kinds.ts`), the loader the scenes are
 * compared with says it by its library's flags and type names — named here, for the comparison
 * alone (`scenes.fixture.ts`).
 */
type Fields = Record<string, unknown>;

/** The library's flag of each node kind, the most specific first. */
const NODE_FLAGS = [
  ['isInstancedMesh', 'instancedMesh'],
  ['isMesh', 'mesh'],
  ['isDirectionalLight', 'directional'],
  ['isPointLight', 'point'],
  ['isSpotLight', 'spot'],
  ['isAmbientLight', 'ambient'],
  ['isRectAreaLight', 'rect'],
  ['isLightProbe', 'probe'],
  ['isCamera', 'camera'],
  ['isScene', 'scene'],
  ['isGroup', 'group'],
] as const;
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
};

/** The node's kind: `'mesh'`, `'spot'`, `'camera'`… or `'node'`. */
export const nodeKind = (node: Fields): string =>
  typeof node.kind === 'string'
    ? node.kind
    : (NODE_FLAGS.find(([flag]) => node[flag]) ?? ['', 'node'])[1];

/** Whether the node is drawn, lit by, or an eye. */
export const isDrawnKind = (kind: string) => kind === 'mesh' || kind === 'instancedMesh';
export const isLightKind = (kind: string) =>
  ['directional', 'point', 'spot', 'ambient', 'rect', 'probe'].includes(kind);

/** The surface's family. */
export const surfaceFamily = (surface: Fields) =>
  (surface.family as string | undefined) ?? FAMILIES[surface.type as string];

/** A texture's kind — `'texture'`, or `'texels'` for raw texels —, `undefined` for anything else. */
export function textureKind(value: Fields | null | undefined) {
  if (!value) return undefined;
  if (value.kind === 'texture' || value.kind === 'texels') return value.kind;
  if (value.isTexture) return value.isDataTexture ? 'texels' : 'texture';
  return undefined;
}

/** Whether the value is a vertex attribute, owning its storage or viewing a shared one. */
export const isAttribute = (value: Fields | null | undefined) =>
  !!value &&
  (value.kind === 'attribute' ||
    value.kind === 'interleavedAttribute' ||
    !!value.isBufferAttribute ||
    !!value.isInterleavedBufferAttribute);
