// A generated scene of many meshes as the engine's world upload sees it (`worldUpload.ts`): every
// mesh a selection root under one holder group, a GPU cut that records what each send compares
// and copies, and `image`: the scene read, then its worlds uploaded.
import * as G from '../../../host/graph/graph.fixture.ts'
import { runtime, selectionRoot } from '../../core/transformShear.fixture.ts'
import { hostWorldPlacements } from '../../../host/world/placements.ts'
import { uploadWorlds } from './worldUpload.ts'

/** A scene of `count` meshes under one holder group, each a selection root and, `blend` true, the
 *  source of a see-through draw; its first image taken. */
export function hostScene(count: number, blend = false) {
  const source = new G.Group(),
    holder = new G.Group(),
    first = G.mesh()
  const meshes = [first, ...Array.from({ length: count - 1 }, () => G.mesh(first.geometry))]
  source.add(holder)
  for (const mesh of meshes) holder.add(mesh)
  meshes.forEach((mesh, k) => (mesh.name = `m${k}`))
  const worlds = hostWorldPlacements(source)
  const roots = meshes.map((mesh) => selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds))
  const { rt, run, motions } = runtime(source, roots, worlds)
  const sent: number[] = [],
    parks: number[] = [],
    blendGpu = blend ? meshes.map((mesh) => ({ sourceMesh: mesh })) : []
  Object.assign(rt, {
    vis: {},
    timing: { worldCounts: { rootsUploaded: 0 } },
    blendState: { ...rt.blendState, blendGpu },
  })
  Object.assign(rt.layout, { worldUpdates: new Float32Array(count * 16) })
  run.gpuSelection = {
    // What a send compares and copies: the worlds of every root, or of those named.
    updateWorlds: (_: Float32Array, named?: Int32Array) => (
      sent.push(named ? named.length : count),
      named ?? new Int32Array(0)
    ),
    parkWorld: (rank: number) => void parks.push(rank),
    markWorld() {},
  } as never
  // The drawn entries, read again whenever the watched list is: roots a test adds included.
  const drawn = () => roots.map((root) => root.pages[0])
  const image = () => {
    run.gate.readScene(source, drawn)
    uploadWorlds(rt)
  }
  image()
  return { source, holder, meshes, roots, worlds, rt, run, sent, parks, blendGpu, motions, image }
}

/** Every read the scene watch's scan makes of a node's matrix mode on `meshes`, counted. */
export function countScans(meshes: readonly object[]) {
  let reads = 0
  for (const mesh of meshes) {
    let proto = Object.getPrototypeOf(mesh)
    while (!Object.getOwnPropertyDescriptor(proto, 'matrixAutoUpdate'))
      proto = Object.getPrototypeOf(proto)
    const own = Object.getOwnPropertyDescriptor(proto, 'matrixAutoUpdate')!
    Object.defineProperty(mesh, 'matrixAutoUpdate', {
      get: () => (reads++, own.get!.call(mesh)),
      set: (value: boolean) => own.set!.call(mesh, value),
    })
  }
  return () => reads
}

/** `rt` ready for a light set through the engine (`refreshSceneLights`): its capture, its
 *  diagnostics and its light store. */
export function withLightStore(rt: object) {
  const held = rt as { lights: object }
  Object.assign(rt, {
    capture: { capturedRevision: 0 },
    diag: { engineDiagnostic() {} },
    lights: { ...held.lights, store: { count: 1, lightingView: 0, unlit: false } },
  })
}
