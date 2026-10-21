/**
 * What moves in the prepared scene, built from the scene tables alone
 * (`sdk-core/src/scene/core/tableMotion.ts`): each skinned mesh's skeleton — its joints are the
 * scene's own nodes — and the file's clips, whose tracks name the nodes they move, so a mixer
 * on the model plays them (`animation.createMixer(model)`).
 *
 * An instanced skinned node the scene loads with it (`TableNode.bank`) bends by no skeleton: each
 * mesh it draws plays its item's track of the scene's animation banks, posed on the GPU
 * (`bindBanks`). An animated node that streams (`TableNode.streamed`) keeps its skeleton, its morph
 * weights and its place for the clips, and is drawn by the rows its main cell places
 * (`streamedMeshes`, `placed.ts`).
 */
import { EngineError } from '../../../../../sdk-core/src/contracts/cache.ts'
import type { PreparedSceneTables } from '../../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { TableChannel } from '../../../../../sdk-core/src/scene/core/tableMotion.ts'
import {
  bankTrack,
  type AnimationBanks,
} from '../../../../../sdk-core/src/scene/core/animationBanks.ts'
import type { Clip, Track, TrackKind } from '../../../../../sdk-core/src/world/animation/clip.ts'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { Skeleton } from '../../../../../sdk-core/src/world/animation/skeleton.ts'
import type { Mesh } from '../../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { RowLink, StreamedMeshes } from '../../../geometry/partition/rows.ts'
import { isDrawnNode } from '../graph/kinds.ts'

/** The node ranks a clip moves or a skin bends by: what the loader names when the file did not. */
export function movedNodes(tables: Pick<PreparedSceneTables, 'skins' | 'animations'>) {
  const moved = new Set<number>()
  for (const skin of tables.skins) for (const joint of skin.joints) moved.add(joint)
  for (const clip of tables.animations) for (const channel of clip.channels) moved.add(channel.node)
  return moved
}

/** Visits only primitives owned by this source node, including multipart wrappers. */
function ownedMeshes(
  node: Object3D,
  sourceNodes: ReadonlySet<Object3D>,
  visit: (mesh: Mesh<object>) => void,
) {
  if (isDrawnNode(node)) visit(node)
  for (const child of node.children)
    if (!sourceNodes.has(child)) ownedMeshes(child, sourceNodes, visit)
}

/** Sets each skinned node's skeleton on the meshes it draws; its joints are `nodes` by rank. A
 *  banked node bends by none: its track poses it (`bindBanks`). */
export function bindSkins(tables: PreparedSceneTables, nodes: readonly Object3D[]) {
  const sourceNodes = new Set(nodes)
  const skeletons = tables.skins.map(
    (skin) =>
      new Skeleton(
        skin.joints.map((joint) => nodes[joint]),
        skin.inverseBindMatrices ?? skin.joints.flatMap(() => new Matrix4().toArray()),
      ),
  )
  tables.nodes.forEach((declared, id) => {
    if (declared.skin === null || declared.bank !== undefined || !nodes[id]) return
    ownedMeshes(nodes[id], sourceNodes, (part) => {
      part.skeleton = skeletons[declared.skin!]
    })
  })
}

/**
 * Sets on each mesh a banked node draws (`TableNode.bank`) the track of `banks` its item plays:
 * one track per item (`bankTrack`), shared by every mesh and every row that plays it — every
 * instance of an item is in one pose. A node naming an item the scene's banks do not hold — or a
 * scene that has none — is refused by name.
 */
export function bindBanks(
  tables: PreparedSceneTables,
  nodes: readonly Object3D[],
  banks: AnimationBanks | null | undefined,
) {
  const sourceNodes = new Set(nodes)
  tables.nodes.forEach((declared, id) => {
    const item = declared.bank
    if (item === undefined || !nodes[id]) return
    if (!banks?.items[item])
      throw new EngineError(
        'PREPARED_SCENE_MISMATCH',
        `node ${id} plays item ${item} of animation banks the scene does not hold`,
        { node: id, item },
      )
    const track = bankTrack(banks, item)
    ownedMeshes(nodes[id], sourceNodes, (part) => {
      part.bank = track
    })
  })
}

/**
 * The meshes each streamed node draws (`TableNode.streamed`), by its rank, each at its primitive's
 * rank in its association (`RowLink.primitives`): what a row its main cell draws from that node's
 * own mesh reads — its skeleton, its morph weights (`CellNode.source`).
 */
export function streamedMeshes(
  tables: PreparedSceneTables,
  nodes: readonly Object3D[],
  ranks: ReadonlyMap<Object3D, RowLink>,
): StreamedMeshes {
  const sourceNodes = new Set(nodes)
  const streamed = new Map<number, Mesh<object>[]>()
  tables.nodes.forEach((declared, id) => {
    if (!declared.streamed || !nodes[id]) return
    const drawn: Mesh<object>[] = []
    ownedMeshes(nodes[id], sourceNodes, (part) => {
      drawn[ranks.get(part)?.primitives ?? drawn.length] = part
    })
    streamed.set(id, drawn)
  })
  return streamed
}

const KINDS: Record<TableChannel['path'], [string, TrackKind]> = {
  translation: ['position', 'vector'],
  rotation: ['quaternion', 'quaternion'],
  scale: ['scale', 'vector'],
  weights: ['morphTargetInfluences', 'weights'],
}
const INTERPOLATION = { LINEAR: 'linear', STEP: 'step', CUBICSPLINE: 'cubic' } as const

/** The file's clips, each channel a track on the node it moves — a morph channel one track on
 *  each mesh the node draws, since each holds its own weights. */
export function clipsOf(tables: PreparedSceneTables, nodes: readonly Object3D[]): Clip[] {
  const sourceNodes = new Set(nodes)
  return tables.animations.map((declared, rank) => {
    const tracks: Track[] = []
    let duration = 0
    for (const channel of declared.channels) {
      const node = nodes[channel.node]
      if (!node) continue
      const [field, kind] = KINDS[channel.path]
      const drawn: Object3D[] = []
      if (channel.path === 'weights') ownedMeshes(node, sourceNodes, (part) => drawn.push(part))
      const targets = channel.path === 'weights' ? drawn : [node]
      for (const target of targets)
        tracks.push({
          name: `${target.name}.${field}`,
          kind,
          times: new Float32Array(channel.times),
          values: new Float32Array(channel.values),
          interpolation: INTERPOLATION[channel.interpolation],
        })
      duration = Math.max(duration, channel.times[channel.times.length - 1] ?? 0)
    }
    return { name: declared.name || `animation_${rank}`, duration, tracks }
  })
}
