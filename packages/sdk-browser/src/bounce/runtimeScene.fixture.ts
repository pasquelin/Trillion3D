// The scene the run-time proxy's tests run over: cubes turned and stretched, packed with the culling's
// tree, and the proxy's buffer as the shader reads it.
import * as G from '../host/graph/graph.fixture.ts'
import { scenePages, sceneRoots } from '../gpu/dag/cutFrontierScene.fixture.ts'
import { packDagSelection } from '../gpu/dag/selection.ts'
import { sdkWasm } from '../wasm/sdkWasm.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import { buildCutProxy } from '../world/page/runtimeProxy.ts'
import { cubeGeometry } from '../world/page/cube.fixture.ts'
import { INSTANCE_WORDS, RUNTIME_NONE, SURFACE_WORDS } from './runtimeLayout.ts'
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
    /** The tree's nodes and members' order as a part of a split table holds them: the part begins at
     *  this node and this word of the table, which the header names. */
    shift?: { nodes: number; cold: number }
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
    copyWorldsAt = (count + copies.length) * INSTANCE_WORDS,
    surfacesAt = copyWorldsAt + copies.length * 16,
    trianglesAt = surfacesAt + surfaces.length * SURFACE_WORDS,
    boundsAt = trianglesAt + triangles * PROXY_TRIANGLE_FLOATS,
    childrenAt = boundsAt + nodes * PROXY_NODE_FLOATS
  const words = new Uint32Array(childrenAt + nodes * PROXY_NODE_WORDS)
  for (let w = 0; w < count + copies.length; w++)
    words.set([0, 0, options.surfaceOf?.(w) ?? 0, 0], instancesAt + w * INSTANCE_WORDS)
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
  const tree = packed.placementTree
  const header = {
    instances: count,
    instancesWord: instancesAt,
    surfacesWord: surfacesAt,
    trianglesWord: trianglesAt,
    copyWorldsWord: copyWorldsAt,
    boundsWord: boundsAt,
    childrenWord: childrenAt,
    treeRoot: tree ? tree.levels[0].base : RUNTIME_NONE,
    membersWord: tree?.members ?? 0,
    members: tree ? tree.count : count,
    worldStride: 16,
    worldRows: count,
    error: 0,
    nodeFirst: options.shift?.nodes ?? 0,
    coldFirst: options.shift?.cold ?? 0,
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
  // The tables as the shader's bindings hold them: the part of the culling's, after the shift.
  const shift = options.shift ?? { nodes: 0, cold: 0 }
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
  const nodesPart = nodeWords.subarray(shift.nodes * 24),
    coldPart = coldWords.subarray(shift.cold)
  const copyWorlds = new Float32Array(copies.length * 16)
  copies.forEach((m, k) => copyWorlds.set(m.elements, k * 16))
  return {
    packed,
    header,
    nodes: nodesPart,
    cold: coldPart,
    scene: { packed, columns, instances, copyBase: count, copyWorlds } satisfies OracleScene,
  }
}
