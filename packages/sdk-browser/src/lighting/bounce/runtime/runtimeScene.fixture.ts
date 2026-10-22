// The scene the run-time proxy's tests run over: cubes turned and stretched, packed with the culling's
// tree, the proxy's buffer as the shader reads it, and the culling's record tables it reads beside it:
// the worlds, whose `Instance` field holds the instances, and the placement tree.
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { scenePages, sceneRoots } from '../../../geometry/dag/cut/cutFrontierScene.fixture.ts'
import { packDagSelection } from '../../../geometry/dag/pack/pack.ts'
import { treeNodeCount, TREE_SPAN } from '../../../geometry/dag/placement/placementTree.ts'
import { DAG_NODE_FLOATS } from '../../../geometry/dag/types.ts'
import { TREE_TABLE } from '../../../geometry/dag/tree/treeTable.ts'
import { sdkWasm } from '../../../wasm/sdkWasm.fixture.ts'
import { PROXY_TRIANGLE_FLOATS } from '../../../../../sdk-core/src/contracts/writtenFormats.ts'
import { buildCutProxy } from '../../../geometry/runtime/runtimeProxy.ts'
import { cubeGeometry } from '../../../geometry/runtime/cube.fixture.ts'
import { proxyArena, proxyHeader } from '../proxyBuffer.fixture.ts'
import { packDoubles } from '../../../../../math/src/float/splitDouble.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { subtract, type Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { recordTable } from '../../../gpu/core/recordTexture.fixture.ts'
import { WORLD_TABLE } from '../../../geometry/dag/worlds/worldTable.ts'
import type { ArenaColumns, Instance } from './runtimeOracle.fixture.ts'
import type { OracleScene } from './runtimeSceneOracle.fixture.ts'

/** A unit cube's cut, as the builder holds it. */
export function cubeCut() {
  const { indices, positions } = cubeGeometry()
  return buildCutProxy(sdkWasm, indices, positions)
}

/** `count` cubes turned and stretched, packed with the culling's tree, the run-time proxy's buffer
 *  over them as the shader reads it — the surfaces, then the cut's columns —,
 *  and the culling's record tables the trace reads beside it: `worlds`, the instances in its
 *  `Instance` field, and `tree`. */
export function world(
  count: number,
  seed: number,
  options: {
    places?: Matrix4[]
    surfaces?: number[][]
    surfaceOf?: (w: number) => number
  } = {},
) {
  const random = lcgRandom(seed),
    side = Math.ceil(Math.sqrt(count))
  const worlds =
    options.places ??
    Array.from({ length: count }, (_, w) => {
      const turn = random() * 6.28,
        [sx, sy, sz] = [0.5 + random(), 0.5 + random(), 0.5 + random()],
        [c, s] = [Math.cos(turn), Math.sin(turn)]
      const m = new Matrix4()
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
  const cut = cubeCut()
  const triangles = cut.triangles.length / PROXY_TRIANGLE_FLOATS
  const surfaces = options.surfaces ?? [[1, 1, 1, 1, 0, 0, 0, 0]]
  const tree = packed.placementTree
  // The placements' records as the culling holds them: each instance wearing the
  // cube's cut, its first node and triangle, the surface asked; each placement's matrix, and its
  // exact translation beside it, three doubles.
  const table = recordTable(WORLD_TABLE, count),
    origin = new Uint32Array(8)
  for (let w = 0; w < count; w++) table.set('Instance', w, [0, 0, options.surfaceOf?.(w) ?? 0, 0])
  for (let w = 0; w < count; w++) {
    table.set(
      'Matrix',
      w,
      new Uint32Array(packed.worlds.buffer, packed.worlds.byteOffset + w * 64, 16),
    )
    packDoubles(origin, 0, worlds[w].elements, 12, 3)
    table.set('Origin', w, origin)
  }
  // The placement tree in its table, as the culling holds it: its nodes, then its order.
  const treeTable = recordTable(TREE_TABLE, Math.max(1, treeNodeCount(tree)))
  if (tree) {
    const nodeWords = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
    for (let n = 0; n < treeNodeCount(tree); n++)
      treeTable.set('Node', n, nodeWords.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS))
    for (let r = 0; r * TREE_SPAN < tree.capacity; r++)
      treeTable.set('Members', r, tree.order.subarray(r * TREE_SPAN, (r + 1) * TREE_SPAN))
  }
  const arena = proxyArena(cut, surfaces)
  const header = {
    ...proxyHeader(arena, {
      instances: count,
      treeRoot: tree ? 0 : NO_INDEX,
      members: tree ? tree.count : count,
    }),
    words: arena.words,
  }
  const columns: ArenaColumns = {
    triangles: cut.triangles,
    nodeBounds: cut.nodeBounds,
    nodeChildren: cut.nodeChildren,
  }
  const instances = new Map<number, Instance>(
    Array.from({ length: count }, (_, w) => [w, { node: 0, triangle: 0, triangles }]),
  )
  return {
    packed,
    header,
    worlds: table,
    tree: treeTable,
    scene: { packed, columns, instances } satisfies OracleScene,
  }
}

/** One placement of one mesh made of unit cubes joined, one `scale`d and moved to each of `offsets`: a mesh whose
 *  own tree has inner nodes, one opaque surface, the placements tried in turn (no tree). */
export function joinedCubes(offsets: Vec3[], scale = 1) {
  const { indices, positions } = cubeGeometry()
  const moved = new Float32Array(positions.length * offsets.length),
    joined = new Uint32Array(indices.length * offsets.length)
  offsets.forEach((offset, k) => {
    positions.forEach((p, i) => (moved[k * positions.length + i] = p * scale + offset[i % 3]))
    indices.forEach((v, i) => (joined[k * indices.length + i] = v + 8 * k))
  })
  const surfaces = [[0.5, 0.25, 0, 1, 0, 0, 0, 0]]
  const arena = proxyArena(buildCutProxy(sdkWasm, joined, moved), surfaces)
  const header = proxyHeader(arena, { instances: 1, treeRoot: NO_INDEX, members: 1 })
  return {
    ...world(1, 1, { places: [new Matrix4()], surfaces }),
    header: { ...header, words: arena.words },
  }
}

/** A random ray over the field of `count` cubes `world` lays three metres apart: from 4 to 6 m
 *  above it, toward a point of it half a metre up, both drawn by `random` in one fixed order. */
export function fieldRay(random: () => number, count: number) {
  const side = Math.ceil(Math.sqrt(count)) * 3
  const origin: Vec3 = [random() * side, 4 + random() * 2, random() * side]
  const target: Vec3 = [random() * side, 0.5, random() * side]
  return { origin, direction: subtract(target, origin) }
}
