import { HIZ_NEAREST_BUILD, HIZ_SHADER, HIZ_TEST_PAGES_ENTRIES, hizBindEntries } from './shader.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { validated } from '../core/errorScope.ts'
import { shaderFailed } from '../core/shaderModule.ts'
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { HIZ_SLOT_WORDS } from './uniforms.ts'

/**
 * The Hi-Z kernels — the build of each layer, one kernel specialized (`HIZ_NEAREST_BUILD`), and the
 * test — compiled under one device validation scope, once a device: every pyramid of the device
 * shares them, so a pyramid made later compiles nothing.
 */
export const createHizPipelines = oncePerDevice((device) =>
  validated(device, async () => {
    const layout = device.createBindGroupLayout({
      entries: hizBindEntries(HIZ_SLOT_WORDS * 4),
    })
    const module = device.createShaderModule({ code: HIZ_SHADER })
    if (await shaderFailed(module)) return undefined
    const pagesLayout = device.createBindGroupLayout({ entries: HIZ_TEST_PAGES_ENTRIES })
    const stage = (entryPoint: string, groups = [layout], constants?: Record<string, number>) =>
      buildComputePipeline(device, {
        layout: device.createPipelineLayout({ bindGroupLayouts: groups }),
        compute: { module, entryPoint, ...(constants && { constants }) },
      })
    const [buildPipeline, nearestPipeline, testPipeline] = await Promise.all([
      stage('buildHiz'),
      stage('buildHiz', [layout], { [HIZ_NEAREST_BUILD]: 1 }),
      stage('testHiz', [layout, pagesLayout]),
    ])
    return { layout, pagesLayout, buildPipeline, nearestPipeline, testPipeline }
  }),
)

/** The test's page-table group (group 1), remade only when the table changes identity (it grows):
 *  one per pyramid, never in the device's shared pipelines, where two pyramids would remake it. */
export function hizPagesGroup(device: GPUDevice, layout: GPUBindGroupLayout) {
  let bound: GPUBuffer | undefined, group: GPUBindGroup | undefined
  return (pages: GPUBuffer) => {
    if (pages !== bound || !group)
      group = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { buffer: pages } }],
      })
    bound = pages
    return group
  }
}

/** A partial GPU setup must release every resource it has acquired. */
export function cleanupFailedHiz(buffers: GPUBuffer[], owned?: { destroy(): void }) {
  for (const buffer of buffers)
    try {
      buffer.destroy()
    } catch {
      /* Partial setup. */
    }
  try {
    owned?.destroy()
  } catch {
    /* Partial setup. */
  }
}
