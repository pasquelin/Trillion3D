// The occlusion's image reaches the lit pass in a buffer its view owns: sized by the grid, counted in the view's bytes, written by
// a pass that names the texture of the history the image ended in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { HizDepth } from '../../../visibility/hiz/gpu/types.ts'
import { AO_DOWNSAMPLE } from './cones.ts'
import { dfaoGroups } from './groups.ts'
import { DFAO_BINDING as B } from './layout.ts'
import { dfaoPrograms } from './pipelines.ts'
import { DFAO_READ_WORDS } from './readWgsl.ts'
import { ensureDfaoView } from './view.ts'

/** The frame's sources, as texture views and a uniform of the kinds the groups' layouts name. */
function sources(device: GPUDevice) {
  const view = (format: GPUTextureFormat, layers = 1) =>
    device
      .createTexture({
        size: [4, 4, layers],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView(layers > 1 ? { dimension: '2d-array' } : {})
  const uniform = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
  return {
    depth: {
      resources: [view('r32float', 2), view('r32uint', 2), { buffer: uniform }],
    } as unknown as HizDepth,
    surfaceNormals: view('rgba16float'),
    vectors: view('r32uint'),
    field: undefined,
    objects: undefined,
  }
}

test('the view holds a buffer for the lit pass, two words a cell of the grid, and the uniform that describes it', () => {
  const { device } = fakeDevice()
  const extent: [number, number] = [64, 48]
  const { view } = ensureDfaoView(undefined, device, { extent, objects: 1, perTile: 4 })
  assert.ok(view)
  const grid = [extent[0] / AO_DOWNSAMPLE, extent[1] / AO_DOWNSAMPLE]
  assert.equal((view.packed as unknown as { size: number }).size, grid[0] * grid[1] * 8)
  assert.equal((view.readParams as unknown as { size: number }).size, DFAO_READ_WORDS * 4)
  assert.ok(
    view.bytes >= grid[0] * grid[1] * 8 + DFAO_READ_WORDS * 4,
    'counted in the view’s bytes',
  )
})

test('a pass packs the image from whichever texture of the history it ended in', () => {
  const { device } = fakeDevice()
  const { view } = ensureDfaoView(undefined, device, { extent: [64, 48], objects: 1, perTile: 4 })
  assert.ok(view)
  const groups = dfaoGroups(device, dfaoPrograms(device), view, sources(device), 0)
  const bound = (name: string) =>
    Object.fromEntries(
      ((groups[name] as unknown as GPUBindGroupDescriptor).entries as GPUBindGroupEntry[]).map(
        (e) => [e.binding, (e.resource as GPUBufferBinding).buffer ?? e.resource],
      ),
    )
  for (const at of [0, 1] as const) {
    const entries = bound(`pack${at}`)
    assert.equal(entries[B.history], view.history[at].view, `the image in texture ${at}`)
    assert.equal(entries[B.packed], view.packed)
  }
})
