// The visibility uniform (`VIS_UNIFORM_BYTES`). Defect this test catches: a group binds it at
// another size than the struct the shaders declare — the real device then refuses the dispatch.
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuVisibilityShaders } from '../../visibility/passes/shaders.ts'
import { smallBindEntries, visBindEntries } from './bindEntries.ts'
import { SMALL_BINDINGS, VIS_BINDINGS, VIS_UNIFORM_BYTES } from './bindLayout.ts'
import { VIS_UNIFORMS_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

const buffer = {} as GPUBuffer
const textures = {
  color: { views: [{}, {}, {}], pages: { buffer } },
} as unknown as WebgpuTileStreamer
const sizeAt = (entries: GPUBindGroupEntry[], binding: number) =>
  (entries.find((entry) => entry.binding === binding)?.resource as GPUBufferBinding).size

test('every group that binds the visibility uniform spans the whole struct', () => {
  const shared = {
    textures,
    sampler: {} as GPUSampler,
    uniform: buffer,
    material: {} as GPUTextureView,
    normals: {} as GPUTextureView,
  }
  const vis = visBindEntries({
    ...shared,
    cache: buffer,
    position: buffer,
    pageTable: buffer,
    uniformOffset: 256,
    uv: buffer,
    instances: buffer,
    slotOffsets: buffer,
  })
  const small = smallBindEntries({
    ...shared,
    indices: buffer,
    positions: buffer,
    pages: buffer,
    uvs: buffer,
    work: buffer,
  })
  assert.equal(sizeAt(vis, VIS_BINDINGS.uniform), VIS_UNIFORM_BYTES)
  assert.equal(sizeAt(small, SMALL_BINDINGS.uniform), VIS_UNIFORM_BYTES)
})

test('both stages read the visibility uniform, at the size of its struct', async () => {
  const { device } = fakeDevice()
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8)
  const entry = (
    visBindGroupLayout as unknown as { entries: GPUBindGroupLayoutEntry[] }
  ).entries.find((candidate) => candidate.binding === VIS_BINDINGS.uniform)!
  // The fragment reads its texture level bias.
  assert.equal(entry.visibility, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT)
  assert.equal(entry.buffer?.minBindingSize, VIS_UNIFORM_BYTES)
})

// A member's bytes and alignment, as WGSL's struct rules give them.
const MEMBERS = {
  f32: [4, 4],
  u32: [4, 4],
  vec2f: [8, 8],
  vec3f: [12, 16],
  vec4f: [16, 16],
  mat4x4f: [64, 16],
}

test('the uniform size covers its members, laid out as WGSL lays them, rounded to the matrix alignment', () => {
  const source = wgslSource(VIS_UNIFORMS_WGSL)
  let end = 0
  for (const [, type] of source.matchAll(/\w+:(f32|u32|vec2f|vec3f|vec4f|mat4x4f),/g)) {
    const [bytes, align] = MEMBERS[type as keyof typeof MEMBERS]
    end = alignUp(end, align) + bytes
  }
  // The cluster split's words — whether any cluster is the software raster's — then the view's
  // clip plane and whether the split routes what reaches behind it (`clipPlane`, `clipRoute`).
  assert.match(
    source,
    /hardwareEdge:f32,softwareRaster:u32,(\w+:u32,)*clipPlane:vec4f,clipRoute:u32,\}$/,
  )
  assert.equal(VIS_UNIFORM_BYTES, alignUp(end, 16))
})
