// Vertex bytes published by metrics().
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { Scene } from '../../../packages/sdk-browser/src/world/core/scene.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import { createWebgpuGpuState } from '../../../packages/sdk-browser/src/webgpu/pages/state/gpu.ts'
import { createWebgpuBlendState } from '../../../packages/sdk-browser/src/webgpu/blend/state.ts'
import { ensureWebgpuPositionBuffer } from '../../../packages/sdk-browser/src/webgpu/core/positions.ts'
import { prepareWebgpuBlend } from '../../../packages/sdk-browser/src/webgpu/blend/prepare.ts'
import { vertexBytesOf } from '../../../packages/sdk-browser/src/webgpu/pages/io/metrics.ts'
import type { VertexPool } from '../../../packages/sdk-browser/src/webgpu/core/geometryPool.ts'
import { measure } from '../../core/measure.ts'
import { stress } from '../../core/measureStress.ts'
import { rapport } from '../../core/report.ts'
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'
import { referenceVertexBytes } from '../../oracles/browser/byte-metrics.ts'
import { installGpuGlobals } from '../../../tests/kit/gpu/globals.ts'

installGpuGlobals()

// A device fixture standing in for the real WebGPU one: only the members the measured functions
// read are implemented, as the rest of this codebase's own GPUDevice fixtures do. The blend's
// normals ride in a float atlas, so the device makes textures too.
const device = {
  limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 },
  createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
  createTexture: () => ({ createView: () => ({}), destroy() {} }),
  queue: { writeBuffer() {}, writeTexture() {} },
} as unknown as GPUDevice

function geometry(vertices: number, alea: () => number) {
  const geo = new Geometry()
  const pos = new Float32Array(vertices * 3)
  for (let i = 0; i < pos.length; i++) pos[i] = alea() * 2 - 1
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(vertices * 3), 3))
  geo.setAttribute('tangent', new BufferAttribute(new Float32Array(vertices * 4), 4))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(vertices * 2), 2))
  const index = new Uint32Array(vertices - (vertices % 3))
  for (let i = 0; i < index.length; i++) index[i] = i % vertices
  geo.setIndex(new BufferAttribute(index, 1))
  return geo
}

function state(pages: number, transparents: number, concats: boolean, depart: number) {
  const alea = xorshiftRandom(depart)
  const gpu = createWebgpuGpuState([1, 1]),
    blendState = createWebgpuBlendState(),
    scene = new Scene()
  for (let i = 0; i < pages; i++)
    ensureWebgpuPositionBuffer(
      device,
      geometry(3 + (i % 17), alea).attributes,
      gpu.positionBuffers,
      gpu,
    )
  const copies = []
  for (let i = 0; i < transparents; i++) {
    const paint = G.standardSurface({ transparent: true, opacity: 0.5 })
    const mesh = G.mesh(geometry(6 + (i % 23), alea), paint)
    mesh.updateMatrix()
    scene.add(mesh)
    copies.push(Object.assign(mesh, { surface: surfaceOf(paint) }))
  }
  prepareWebgpuBlend(device, copies, gpu, blendState, scene)
  const tamponDe = (size: number) => device.createBuffer({ size, usage: 0 })
  const vis = concats
    ? {
        concatPos: tamponDe(0),
        concatUv: tamponDe(2 ** 31),
        vertexPool: { normalBytes: 4096 } as VertexPool,
      }
    : { concatPos: undefined, concatUv: undefined, vertexPool: undefined }
  return { gpu, vis, blendState }
}

const grand = state(400, 200, true, 0x41)
const petit = state(2, 1, true, 0x43)

const resOctets = await measure({
  name: 'vertex bytes of report',
  fichier: 'packages/sdk-browser/src/webgpu/pages/io/metrics.ts',
  cas: [
    { name: '400 pages, 200 transparents', input: grand, size: 600 },
    { name: '2 pages, 1 transparent', input: petit, size: 3 },
  ],
  calculation: ({ gpu, vis }) => vertexBytesOf(gpu, vis),
  expected: ({ gpu, vis, blendState }) => referenceVertexBytes(gpu, vis, blendState),
  options: { tours: 100, budgetMs: 1500 },
})

await stress({
  name: 'vertexBytesOf extremes',
  calculation: () =>
    vertexBytesOf(createWebgpuGpuState([1, 1]), {
      concatPos: undefined,
      concatUv: undefined,
      vertexPool: undefined,
    }),
  extremes: [{ name: 'empty', input: null }],
})

rapport('metriques-octets', [resOctets], 'G4 publishes exact same vertex bytes')
