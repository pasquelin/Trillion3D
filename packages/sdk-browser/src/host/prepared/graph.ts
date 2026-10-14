/**
 * The host scene graph of the prepared scene, assembled from the node table under the rules the
 * host loader applied, since the scene the engine draws is proven by being the same scene:
 *
 * - a node carrying one thing IS that thing (a mesh, a camera, a light), one carrying several is a group of
 *   them, one carrying nothing is a bare node; its children follow what it carries;
 * - a mesh of one primitive is one host mesh, a mesh of several a group of one host mesh each;
 * - a mesh, a camera or a light several nodes name is copied per node, the copies sharing geometry and
 *   surface, and named `_instance_<n>` in turn;
 * - names are made unique in the order the loader reserved them: scene, then each node, its
 *   camera and its light depth first, then each mesh as its surfaces are ready — in the order
 *   they are first named when they are ready together, in the order their images land when not;
 * - a node's pose is set from what it declares: a matrix decomposed, or its translation, rotation
 *   and scale as they are — so the engine composes the same world matrices from them.
 */
import { readPreparedSourceRank } from './sourceRanks.ts'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import { camera, light, pose, uniqueNames, weigh } from './nodes.ts'
import { buildMeshes, type MeshInputs } from './meshes.ts'
import { isDrawnNode } from '../graph/kinds.ts'
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { placedMeshes } from './placed.ts'
import { bindSkins, clipsOf, movedNodes } from './motion.ts'
import type { RowLink } from '../../partition/rows.ts'

/** What the engine knows a drawn mesh by: its mesh and primitive ranks, and the rows placing it
 *  when a partition's cells do. */
type MeshRanks = RowLink

type Inputs = MeshInputs & { tables: PreparedSceneTables }

/** The prepared scene as a host graph, and the ranks each drawn host mesh answers to. */
export async function preparedGraph(inputs: Inputs) {
  const { tables } = inputs
  const unique = uniqueNames()
  const ranks = new Map<Object3D, MeshRanks>()
  const scene = new Group()
  if (tables.scene.name) scene.name = unique(tables.scene.name)
  const reference = referencer(tables, unique, ranks)
  const names = reserveNames(tables, unique)
  const { made, built } = await buildMeshes(inputs, names.order, unique, ranks)
  const { nodes, assemble } = assembler(tables, names, built, reference)
  for (const root of tables.scene.nodes) scene.add(assemble(root))
  bindSkins(tables, nodes)
  const clips = clipsOf(tables, nodes)
  const at = new Map(names.order.map((rank, index) => [rank, index]))
  const placed = placedMeshes(tables.partition, scene, ranks, (rank) => made[at.get(rank)!])
  return { scene, ranks, nodes, placed, clips }
}

type Unique = ReturnType<typeof uniqueNames>

/** The object a node names, or its copy when several nodes name it. */
function referencer(tables: PreparedSceneTables, unique: Unique, ranks: Map<Object3D, MeshRanks>) {
  const refs = (field: 'mesh' | 'light' | 'camera') => {
    const counts = new Map<number, number>()
    for (const node of tables.nodes)
      if (node[field] !== null) counts.set(node[field], (counts.get(node[field]) ?? 0) + 1)
    return counts
  }
  const counts = { mesh: refs('mesh'), light: refs('light'), camera: refs('camera') }
  const uses = new Map<string, number>()
  return (kind: keyof typeof counts, rank: number, made: Object3D) => {
    if ((counts[kind].get(rank) ?? 0) <= 1) return made
    const copy = made.clone()
    const walk = (from: Object3D, to: Object3D) => {
      if (from !== made && from.name) to.name = unique(from.name)
      const held = ranks.get(from)
      if (held) ranks.set(to, held)
      from.children.forEach((child, i) => walk(child, to.children[i]))
    }
    walk(made, copy)
    const key = `${kind}:${rank}`
    const use = uses.get(key) ?? 0
    uses.set(key, use + 1)
    copy.name += `_instance_${use}`
    return copy
  }
}

/** Names first, depth first: node, then its camera, then its light; each camera and each light
 *  is built at its first use. `order` lists the meshes in the order they were first named. */
function reserveNames(tables: PreparedSceneTables, unique: Unique) {
  const cameras = new Map<number, Camera>()
  const lights = new Map<number, Light>()
  const nodeNames = new Map<number, string>()
  const order: number[] = []
  const named = new Set<number>()
  // A node a clip moves or a skin bends by is found by name: one the file left unnamed gets one.
  const moved = movedNodes(tables)
  const reserve = (id: number) => {
    const node = tables.nodes[id]
    const name = node.name || (moved.has(id) ? `node_${id}` : '')
    nodeNames.set(id, name ? unique(name) : '')
    if (node.mesh !== null && !named.has(node.mesh)) {
      named.add(node.mesh)
      order.push(node.mesh)
    }
    if (node.camera !== null && !cameras.has(node.camera)) {
      const declared = tables.cameras[node.camera]
      const made = camera(declared)
      if (declared.name) made.name = unique(declared.name)
      cameras.set(node.camera, made)
    }
    if (node.light !== null && !lights.has(node.light)) {
      const declared = tables.lights[node.light]
      lights.set(node.light, light(declared, unique(declared.name || `light_${node.light}`)))
    }
    for (const child of node.children) reserve(child)
  }
  for (const root of tables.scene.nodes) reserve(root)
  // The meshes the partition's cells place are built with the others, whatever cell brings them.
  for (const rank of tables.partition?.meshes ?? [])
    if (!named.has(rank)) {
      named.add(rank)
      order.push(rank)
    }
  return { cameras, lights, nodeNames, order }
}

/** Builds a node and its subtree as the host loader did; `nodes` holds the host node of each
 *  rank, which a cell's node may hang under. */
function assembler(
  tables: PreparedSceneTables,
  { cameras, lights, nodeNames }: ReturnType<typeof reserveNames>,
  built: ReadonlyMap<number, Object3D>,
  reference: ReturnType<typeof referencer>,
) {
  const nodes: Object3D[] = []
  const assemble = (id: number): Object3D => {
    const declared = tables.nodes[id]
    const carried: Object3D[] = []
    if (declared.mesh !== null) {
      const mesh = reference('mesh', declared.mesh, built.get(declared.mesh)!)
      // Weights a node declares override its mesh's, on every primitive it draws.
      if (declared.weights)
        mesh.traverse((part) => isDrawnNode(part) && weigh(part, declared.weights))
      carried.push(mesh)
    }
    if (declared.camera !== null)
      carried.push(reference('camera', declared.camera, cameras.get(declared.camera)!))
    if (declared.light !== null)
      carried.push(reference('light', declared.light, lights.get(declared.light)!))
    const node =
      carried.length === 1
        ? carried[0]
        : carried.length
          ? new Group().add(...carried)
          : new Object3D()
    if (declared.name) node.userData.name = declared.name
    if (nodeNames.get(id)) node.name = nodeNames.get(id)!
    pose(node, declared)
    // Hidden, it is parked as any hidden node (`placement/hidden.ts`); its subtree with it.
    node.visible = declared.visible
    nodes[id] = node
    // Its declared source rank is checked: a malformed one refuses the tables.
    readPreparedSourceRank(declared.sourceNode, id)
    for (const child of declared.children) node.add(assemble(child))
    return node
  }
  return { nodes, assemble }
}
