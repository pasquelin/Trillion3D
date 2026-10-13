// The scene the run-time proxy's tests run over: cubes turned and stretched, packed with the culling's
// tree, and the proxy's buffer as the shader reads it.
import * as G from '../host/graph/graph.fixture.ts'
import { scenePages, sceneRoots } from '../gpu/dag/cutFrontierScene.fixture.ts'
import { packDagSelection } from '../gpu/dag/selection.ts'
import { treeNodeCount } from '../gpu/dag/placementTree.ts'
import { DAG_NODE_FLOATS } from '../gpu/dag/types.ts'
import { sdkWasm } from '../wasm/sdkWasm.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import { buildCutProxy } from '../world/page/runtimeProxy.ts'
import { cubeGeometry } from '../world/page/cube.fixture.ts'
import {
  INSTANCE_WORDS,
  RUNTIME_NONE,
  RUNTIME_ORIGIN_WORDS,
  RUNTIME_WORLD_WORDS,
  SURFACE_WORDS,
} from './runtimeLayout.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import type { ArenaColumns, Instance } from './runtimeOracle.fixture.ts'
import type { OracleScene } from './runtimeSceneOracle.fixture.ts'

export type Vec = [number, number, number]
export type Hit = { distance: number; placement: number; triangle: number; found: boolean }

export function stream(seed: number) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** A unit cube's cut, as the builder holds it. */
function cube() {
  const { indices, positions } = cubeGeometry()
  return buildCutProxy(sdkWasm, indices, positions)
}

/** `count` cubes turned and stretched, packed with the culling's tree, and the run-time proxy's
 *  buffer over them as the shader reads it: instances, then the cut's columns. */
export function world(
  count: number,
  seed: number,
  options: {
    places?: G.Matrix4[]
    surfaces?: number[][]
    surfaceOf?: (w: number) => number
    /** Blended copies, members after the placements, each a cube at the pose given. */
    copies?: G.Matrix4[]
  } = {},
) {
  const random = stream(seed),
    side = Math.ceil(Math.sqrt(count))
  const worlds =
    options.places ??
    Array.from({ length: count }, (_, w) => {
      const turn = random() * 6.28,
        [sx, sy, sz] = [0.5 + random(), 0.5 + random(), 0.5 + random()],
        [c, s] = [Math.cos(turn), Math.sin(turn)]
      const m = new G.Matrix4()
      m.elements.set([
        c * sx,
        0,
        -s * sx,
        0,
        0,
        sy,
        0,
        0,
        s * sz,
        0,
        c * sz,
        0,
        (w % side) * 3 + random(),
        random(),
        Math.floor(w / side) * 3 + random(),
        1,
      ])
      return m
    })
  const packed = packDagSelection(sceneRoots(scenePages(16, 2), worlds))
  const cut = cube()
  const triangles = cut.triangles.length / PROXY_TRIANGLE_FLOATS,
    nodes = cut.nodeBounds.length / PROXY_NODE_FLOATS
  const surfaces = options.surfaces ?? [[1, 1, 1, 1, 0, 0, 0, 0]]
  const copies = options.copies ?? []
  const instancesAt = 0,
    worldsAt = (count + copies.length) * INSTANCE_WORDS,
    originsAt = worldsAt + count * RUNTIME_WORLD_WORDS,
    copyWorldsAt = originsAt + count * RUNTIME_ORIGIN_WORDS,
    surfacesAt = copyWorldsAt + copies.length * RUNTIME_WORLD_WORDS,
    trianglesAt = surfacesAt + surfaces.length * SURFACE_WORDS,
    boundsAt = trianglesAt + triangles * PROXY_TRIANGLE_FLOATS,
    childrenAt = boundsAt + nodes * PROXY_NODE_FLOATS
  // The placement tree as the proxy's buffer mirrors it: its nodes, then the order of its members.
  const tree = packed.placementTree
  const treeNodes = treeNodeCount(tree),
    treeAt = childrenAt + nodes * PROXY_NODE_WORDS,
    membersAt = treeAt + treeNodes * DAG_NODE_FLOATS
  const words = new Uint32Array(membersAt + (tree?.capacity ?? 0))
  for (let w = 0; w < count + copies.length; w++)
    words.set([0, 0, options.surfaceOf?.(w) ?? 0, 0], instancesAt + w * INSTANCE_WORDS)
  // The placements' worlds, as the proxy's buffer mirrors the culling's.
  new Float32Array(words.buffer, worldsAt * 4, count * 16).set(
    packed.worlds.subarray(0, count * 16),
  )
  // Their exact translations, three doubles each.
  for (let w = 0; w < count; w++)
    packDoubles(words, originsAt + w * RUNTIME_ORIGIN_WORDS, worlds[w].elements, 12, 3)
  copies.forEach((m, k) =>
    new Float32Array(words.buffer, (copyWorldsAt + k * 16) * 4, 16).set(m.elements),
  )
  surfaces.forEach((surface, k) => {
    const at = surfacesAt + k * SURFACE_WORDS
    new Float32Array(words.buffer, at * 4, 7).set(surface.slice(0, 7))
    words[at + 7] = surface[7]
  })
  words.set(new Uint32Array(cut.triangles.buffer), trianglesAt)
  words.set(new Uint32Array(cut.nodeBounds.buffer), boundsAt)
  words.set(cut.nodeChildren, childrenAt)
  if (tree) {
    const nodeWords = new Uint32Array(
      packed.nodes.buffer,
      packed.nodes.byteOffset,
      packed.nodes.length,
    )
    const coldWords = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    )
    words.set(
      nodeWords.subarray(
        tree.cellBase * DAG_NODE_FLOATS,
        (tree.cellBase + treeNodes) * DAG_NODE_FLOATS,
      ),
      treeAt,
    )
    words.set(coldWords.subarray(tree.members, tree.members + tree.capacity), membersAt)
  }
  const header = {
    instances: count,
    instancesWord: instancesAt,
    surfacesWord: surfacesAt,
    trianglesWord: trianglesAt,
    copyWorldsWord: copyWorldsAt,
    boundsWord: boundsAt,
    childrenWord: childrenAt,
    treeRoot: tree ? tree.levels[0].base : RUNTIME_NONE,
    treeFirst: tree?.cellBase ?? 0,
    treeWord: treeAt,
    membersWord: membersAt,
    members: tree ? tree.count : count,
    worldsWord: worldsAt,
    worldRows: count,
    error: 0,
    copies: copies.length,
    originsWord: originsAt,
    words,
  }
  const columns: ArenaColumns = {
    triangles: cut.triangles,
    nodeBounds: cut.nodeBounds,
    nodeChildren: cut.nodeChildren,
  }
  const instances = new Map<number, Instance>(
    Array.from({ length: count + copies.length }, (_, w) => [
      w,
      { node: 0, triangle: 0, triangles },
    ]),
  )
  const copyWorlds = new Float32Array(copies.length * 16)
  copies.forEach((m, k) => copyWorlds.set(m.elements, k * 16))
  return {
    packed,
    header,
    scene: { packed, columns, instances, copyBase: count, copyWorlds } satisfies OracleScene,
  }
}
