import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuVisibilityShaders } from '../../visibility/passes/shaders.ts'
import { createWebgpuShadePipelines } from '../../visibility/passes/shadePipelines.ts'
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import { createGpuRaster } from '../../visibility/raster/raster.ts'
import { createTemporalAntialiasing } from '../../post/taa/temporalAntialiasing.ts'
import { createVelocity } from '../../post/taa/velocity.ts'
import { SHADE_SHADER } from '../../visibility/shader/shadeWgsl.ts'
import { VIS_SHADER } from '../../visibility/shader/visShader.fixture.ts'
import { wgslStageBindings } from '../core/wgslBindings.fixture.ts'
import { VIS_BINDINGS } from './bindLayout.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BLEND_SHADER } from '../core/shaderTexts.fixture.ts'
import {
  colourLayoutEntries,
  indirectLayoutEntries,
  localLayoutEntries,
  sunLayoutEntries,
} from '../../lighting/deferred/layoutEntries.ts'

// Defect this test catches: a layout gains one more storage buffer than WebGPU's guaranteed
// minimum, and the device refuses to create it — “The number of storage buffers (9) in the
// Compute stage exceeds the maximum per-stage limit (8)” — then is lost. No gate saw it: tests
// build layouts on a fake device, with no limits.
const GUARANTEED_STORAGE_BUFFERS_PER_STAGE = 8

/** The hand-written layouts of the frame's passes, each built on a fake device. */
async function passLayouts() {
  const { device } = fakeDevice()
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8)
  const { shadeBindGroupLayout } = await createWebgpuShadePipelines(
    device,
    {} as GPUShaderModule,
    [],
  )
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, [])
  return {
    visibility: visBindGroupLayout,
    'hardware resolve': shadeBindGroupLayout,
    transparents: blendBindGroupLayout,
    'small triangles': await firstLayout((d) => createGpuRaster(d, 4, 4, 8)),
    'temporal antialiasing': await firstLayout((d) =>
      createTemporalAntialiasing(d, createVelocity(d)),
    ),
    // The lit image's passes bind what each reads alone: the surfaces' colour, the sun's light, the local
    // lights', the indirect light — with bounce, its probes and surface cache are atlases, no storage buffer.
    'surface colour': device.createBindGroupLayout({ entries: colourLayoutEntries() }),
    'sun light': device.createBindGroupLayout({ entries: sunLayoutEntries(true) }),
    'sun light with the screen-space contact shadows': device.createBindGroupLayout({
      entries: sunLayoutEntries(true, true),
    }),
    'local lights': device.createBindGroupLayout({ entries: localLayoutEntries(true) }),
    'local lights with the screen-space contact shadows': device.createBindGroupLayout({
      entries: localLayoutEntries(true, true, true),
    }),
    'indirect light': device.createBindGroupLayout({
      entries: indirectLayoutEntries({ bounce: false, skyShadowing: true, lobes: true }),
    }),
    'indirect light with bounce': device.createBindGroupLayout({
      entries: indirectLayoutEntries({ bounce: true, skyShadowing: false, lobes: true }),
    }),
    'indirect light with bounce and the ambient cubemap': device.createBindGroupLayout({
      entries: indirectLayoutEntries({
        bounce: true,
        skyShadowing: false,
        lobes: true,
        cubed: true,
      }),
    }),
  } as Record<string, unknown>
}

const entriesOf = (layout: unknown) => (layout as { entries: GPUBindGroupLayoutEntry[] }).entries

test('no layout exceeds the eight storage buffers guaranteed per stage', async () => {
  const layouts = Object.entries(await passLayouts())
  const stages = {
    VERTEX: GPUShaderStage.VERTEX,
    FRAGMENT: GPUShaderStage.FRAGMENT,
    COMPUTE: GPUShaderStage.COMPUTE,
  }
  for (const [name, layout] of layouts) {
    const entries = entriesOf(layout)
    for (const [stage, bit] of Object.entries(stages)) {
      const seen = entries.filter((entry) => (entry.visibility & bit) !== 0)
      const count = seen.filter(
        (entry) => entry.buffer?.type === 'storage' || entry.buffer?.type === 'read-only-storage',
      ).length
      assert.ok(
        count <= GUARANTEED_STORAGE_BUFFERS_PER_STAGE,
        `${name} binds ${count} storage buffers at stage ${stage}, above the ${GUARANTEED_STORAGE_BUFFERS_PER_STAGE} guaranteed`,
      )
      // The buffers moved to atlases are textures: they hold the textures' own limit.
      const textures = seen.filter((entry) => entry.texture).length
      assert.ok(textures <= 16, `${name} samples ${textures} textures at stage ${stage}, over 16`)
    }
  }
})

// Defect this test catches: a stage reads a binding its layout does not show it. The
// visibility fragment came to read `uni` (the texture level bias of `atlasLod`) while the layout
// gave the uniform to the vertex stage alone; the device refused the pipeline and no WebGPU scene
// opened. Each entry point's reach is read from the shipped text, its calls followed.
test('every binding a stage of the visibility, resolve and transparent passes reads is visible to it', async () => {
  const layouts = await passLayouts()
  const stageBit = {
    vertex: GPUShaderStage.VERTEX,
    fragment: GPUShaderStage.FRAGMENT,
    compute: GPUShaderStage.COMPUTE,
  }
  for (const [name, shader] of [
    ['visibility', VIS_SHADER],
    ['hardware resolve', SHADE_SHADER],
    ['transparents', BLEND_SHADER],
  ]) {
    const entries = entriesOf(layouts[name]),
      reached = wgslStageBindings(shader)
    assert.ok(reached.length > 0, `${name}: its entry points are found`)
    for (const { stage, entry, bindings } of reached)
      for (const binding of bindings) {
        const at = entries.find((candidate) => candidate.binding === binding)
        assert.ok(at, `${name}: ${entry} reads binding ${binding}, absent from the layout`)
        assert.ok(
          (at.visibility & stageBit[stage]) !== 0,
          `${name}: ${entry} (${stage}) reads binding ${binding}, not visible to its stage`,
        )
      }
  }
  // The visibility fragment picks its cutout's level with the frame's texture bias.
  const fragment = wgslStageBindings(VIS_SHADER).find(({ entry }) => entry === 'vis_hiz_fs')
  assert.ok(fragment?.bindings.has(VIS_BINDINGS.uniform), 'vis_hiz_fs reads the uniform')
})

/** First layout a constructor creates on a fake device of its own. */
async function firstLayout(build: (device: GPUDevice) => unknown) {
  const { device, bindGroupLayouts } = fakeDevice()
  await build(device)
  return bindGroupLayouts[0]
}
