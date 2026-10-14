// The scene the run-time proxy's tests run over: cubes turned and stretched, packed with the culling's
// tree, the proxy's buffer and instances as the shader reads them, and the culling's record tables it
// reads beside them: the worlds and the placement tree.
import { NO_INDEX } from '../../../math/src/constants.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { scenePages, sceneRoots } from '../gpu/dag/cutFrontierScene.fixture.ts'
import { packDagSelection } from '../gpu/dag/pack.ts'
import { treeNodeCount, TREE_SPAN } from '../gpu/dag/placementTree.ts'
import { DAG_NODE_FLOATS } from '../gpu/dag/types.ts'
import { TREE_TABLE } from '../gpu/dag/treeTable.ts'
import { sdkWasm } from '../wasm/sdkWasm.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/contracts/writtenFormats.ts'
import { buildCutProxy } from '../world/page/runtimeProxy.ts'
import { cubeGeometry } from '../world/page/cube.fixture.ts'
import { RUNTIME_WORLD_WORDS, SURFACE_WORDS } from './runtimeLayout.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { recordTable } from '../gpu/core/recordTexture.fixture.ts'
import { WORLD_TABLE } from '../gpu/dag/worldTable.ts'
import type { ArenaColumns, Instance } from './runtimeOracle.fixture.ts'
import type { OracleScene } from './runtimeSceneOracle.fixture.ts'

/** A unit cube's cut, as the builder holds it. */
export function cubeCut() {
  const { indices, positions } = cubeGeometry()
  return buildCutProxy(sdkWasm, indices, positions)
}

/** `count` cubes turned and stretched, packed with the culling's tree, the run-time proxy's buffer
 *  over them as the shader reads it — the copies' worlds, the surfaces, then the cut's columns —,
 *  its instances' table (`instances`), and the culling's record tables the trace reads beside it:
 *  `worlds` and `tree`. */
export function world(
  count: number,
  seed: number,
  options: {
    places?: Matrix4[]
    surfaces?: number[][]
    surfaceOf?: (w: number) => number
    /** Blended copies, members after the placements, each a cube at the pose given. */
    copies?: Matrix4[]
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
  const triangles = cut.triangles.length / PROXY_TRIANGLE_FLOATS,
    nodes = cut.nodeBounds.length / PROXY_NODE_FLOATS
  const surfaces = options.surfaces ?? [[1, 1, 1, 1, 0, 0, 0, 0]]
  const copies = options.copies ?? []
  const copyWorldsAt = 0,
    surfacesAt = copyWorldsAt + copies.length * RUNTIME_WORLD_WORDS,
    trianglesAt = surfacesAt + surfaces.length * SURFACE_WORDS,
    boundsAt = trianglesAt + triangles * PROXY_TRIANGLE_FLOATS,
    childrenAt = boundsAt + nodes * PROXY_NODE_FLOATS
  const tree = packed.placementTree
  const words = new Uint32Array(childrenAt + nodes * PROXY_NODE_WORDS)
  // The placements' records as the culling holds them, a copy's after them: each instance wearing the
  // cube's cut, its first node and triangle, the surface asked; each placement's matrix, and its
  // exact translation beside it, three doubles.
  const table = recordTable(WORLD_TABLE, count + copies.length),
    origin = new Uint32Array(8)
  for (let w = 0; w < count + copies.length; w++)
    table.set('Instance', w, [0, 0, options.surfaceOf?.(w) ?? 0, 0])
  for (let w = 0; w < count; w++) {
    table.set(
      'Matrix',
      w,
      new Uint32Array(packed.worlds.buffer, packed.worlds.byteOffset + w * 64, 16),
    )
    packDoubles(origin, 0, worlds[w].elements, 12, 3)
    table.set('Origin', w, origin)
  }
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
  // The placement tree in its table, as the culling holds it: its nodes, then its order.
  const treeTable = recordTable(TREE_TABLE, Math.max(1, treeNodeCount(tree)))
  if (tree) {
    const nodeWords = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
    for (let n = 0; n < treeNodeCount(tree); n++)
      treeTable.set('Node', n, nodeWords.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS))
    for (let r = 0; r * TREE_SPAN < tree.capacity; r++)
      treeTable.set('Members', r, tree.order.subarray(r * TREE_SPAN, (r + 1) * TREE_SPAN))
  }
  const header = {
    instances: count,
    surfacesWord: surfacesAt,
    trianglesWord: trianglesAt,
    copyWorldsWord: copyWorldsAt,
    boundsWord: boundsAt,
    childrenWord: childrenAt,
    treeRoot: tree ? 0 : NO_INDEX,
    members: tree ? tree.count : count,
    error: 0,
    copies: copies.length,
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
    worlds: table,
    tree: treeTable,
    scene: { packed, columns, instances, copyBase: count, copyWorlds } satisfies OracleScene,
  }
}
