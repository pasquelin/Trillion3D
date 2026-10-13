// What the proofs of a source added to a running WebGPU session share: a world of placements of
// one primitive on a mocked device, and the join of one source of placements into it, the bytes
// written to the device counted.
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { MANIFEST_IDENTITY, dagRoots } from '../engine/pagesEngine.fixture.ts'
import { QUAD_MANIFEST, triangleGeometry } from '../engine/pagesEngineScenes.fixture.ts'
import { rootPage } from '../webgpu/pages/rootPages.fixture.ts'
import { mockGpu } from '../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts'
import { createWebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { prepareWebgpuBackend } from '../webgpu/pages/prepare/prepare.ts'
import { disposeWebgpuPages } from '../webgpu/pages/io/metrics.ts'
import { createPlacementRows } from './rows.ts'
import { drawSourceOf, graphDraws } from '../page/selection/drawSource.ts'
import { addWebgpuPlacements } from './webgpuAppend.ts'
import { growthOf, startGrownCut } from './webgpuGrowth.ts'
import { adoptGrownCut } from './webgpuGrownCut.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'

const structure = { version: 1, roots: [0], groups: [] }
/** A primitive of one page, `layer` coplanar layers deep. */
export const primitive = (mesh: number, url: string, layer = 0): Primitive =>
  ({
    mesh,
    primitive: 0,
    pass: 'exact-clusters',
    pages: dagRoots([{ ...rootPage(url, [-1, -1, 0], [1, 1, 0]), depthLayer: layer }]).pages,
    structure,
  }) as never

/** `count` rows of identity poses on a grid, all live. */
function rowsOf(count: number) {
  const rows = createPlacementRows(count)
  for (let i = 0; i < count; i++) {
    const world = rows.matrices.subarray(i * 16, i * 16 + 16)
    world[0] = world[5] = world[10] = world[15] = 1
    world[12] = (i % 500) * 2.5
    world[14] = -Math.floor(i / 500) * 2.5
    rows.live[i] = 1
  }
  return rows
}

/** A session over a world of `placements` of one primitive on a mocked device, and what one source
 *  of `count` placements costs it to join: the bytes written. */
export async function session(placements: number) {
  installGpuGlobals()
  const surface = G.basicSurface({ color: 0xff0000, side: G.DOUBLE_SIDE })
  const geometry = triangleGeometry()
  const mesh = G.mesh(geometry, surface)
  const source = new G.Group()
  source.add(mesh)
  const held = primitive(7, 'held')
  const metadata = { ...QUAD_MANIFEST, primitives: [held], ...MANIFEST_IDENTITY }
  const indices = new Map(['held', 'other'].map((url) => [url, new Uint32Array([0, 1, 2])]))
  const associations = new Map([
    [mesh, { meshes: 7, primitives: 0, placements: rowsOf(placements) }],
  ])
  const gpu = mockGpu({ limits: { maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 1 << 30 } })
  const rt = createWebgpuPagesRuntime({
    ...{ source, metadata, indices, associations, gpuDevice: gpu.device },
    draws: graphDraws(source, associations),
    maxResidentPages: 4096,
    viewport: [1, 1],
  } as never)
  await prepareWebgpuBackend(rt, gpu.device)
  let made = 0
  const join = async (count: number, brings?: Primitive) => {
    const added = G.mesh(
      geometry,
      G.basicSurface({ color: 0x00ff00 + ++made, side: G.DOUBLE_SIDE }),
    )
    const rows = rowsOf(count)
    const ranks = { meshes: brings?.mesh ?? 7, primitives: 0, placements: rows }
    gpu.writes.length = 0
    const cut = rt.run.gpuSelection
    const refused = await addWebgpuPlacements(rt, drawSourceOf(added, ranks), brings ?? held)
    startGrownCut(rt)
    await growthOf(rt)?.making
    assert.ok(adoptGrownCut(rt), 'the roots joined the cut')
    await rt.layout.growing
    const written = new Map<string, number>()
    for (const { label, bytes } of gpu.writes)
      written.set(label ?? '', (written.get(label ?? '') ?? 0) + bytes.length)
    const bytes = [...written.values()].reduce((sum, size) => sum + size, 0)
    return {
      refused,
      bytes,
      cut,
      same: rt.run.gpuSelection === cut,
    }
  }
  return { rt, join, dispose: () => disposeWebgpuPages(rt) }
}
