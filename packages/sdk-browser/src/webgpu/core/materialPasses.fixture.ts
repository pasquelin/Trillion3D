import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts'
import { createPresentClasses } from './materialPasses.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { RenderBundles } from '../../gpu/core/renderBundles.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { replayBundles } from '../../../../../tests/kit/gpu/fakeBundles.ts'

/** A runtime reduced to what the resolve reads, a device that records its bundles, and an encoder
 *  that records its passes: its render passes — what their bundles draw replayed there —, and the
 *  labels of its compute passes in `computePasses`. Its class set holds
 *  `compiled`; `made` names each class a pipeline's `get` had to compile — one nothing asked
 *  (`PreparedPipeline.get`). */
export function resolveFixture(classes: number[], compiled: number[], single: number[] = []) {
  const stride = PAGE_INFO_STRIDE / 4,
    ints = new Uint32Array(stride * classes.length)
  classes.forEach((key, row) => (ints[row * stride + ROW_MATERIAL_CLASS_WORD] = key))
  const made: number[] = [],
    passes: Array<{
      label: string
      pipelines: unknown[]
      draws: number
      depth: unknown
      colors: unknown[]
    }> = []
  const tiles = { assigned: [] as number[][], classified: 0, slots: [] as number[] }
  const computePasses: string[] = []
  const pipeline = (key: number) => ({ key }),
    ordinary = new Map(compiled.map((key) => [key, pipeline(key)])),
    direct = new Map(single.map((key) => [key, pipeline(key)]))
  const rt = {
    gpu: {
      surfaces: { views: () => ['a', 'b', 'c', 'd'] },
      targetSize: [8, 4],
      feedbackView: 'feedback',
    },
    run: { feedbackWritten: false, gpuDrawCalls: 0 },
    layout: { rows: { pageTableInts: ints, packedCount: classes.length } },
    vis: {
      writesFeedback: true,
      shadeBindGroup: 'bind group',
      shadeBundles: new RenderBundles(2),
      shadeClasses: {
        of: (key: number) => ({
          get: () => {
            if (!ordinary.has(key)) ordinary.set(key, (made.push(key), pipeline(key)))
            return ordinary.get(key)
          },
        }),
        keys: () => ordinary.keys(),
        single: (key: number) =>
          direct.has(key) ? { ready: true, get: () => direct.get(key) } : undefined,
      },
      presentClasses: createPresentClasses(),
      visView: 'ids',
      pageTable: 'pages',
      shadeUniform: 'uniform',
      materialTiles: {
        assign: (keys: number[]) => tiles.assigned.push([...keys]),
        layFor: () => 'tile group',
        // A classification dispatches: it opens the frame's pass.
        encode: (open: { pass: unknown }) => void (open.pass, tiles.classified++),
        draw: (pass: { draw(): void }, at: number) => (tiles.slots.push(at), pass.draw()),
      },
    },
  } as unknown as WebgpuPagesRuntime
  const encoder = {
    beginComputePass: (desc: { label: string }) => (computePasses.push(desc.label), { end() {} }),
    beginRenderPass: (desc: {
      label: string
      depthStencilAttachment?: unknown
      colorAttachments?: unknown[]
    }) => {
      const pass = {
        label: desc.label,
        pipelines: [] as unknown[],
        draws: 0,
        depth: desc.depthStencilAttachment,
        colors: desc.colorAttachments ?? [],
      }
      passes.push(pass)
      const commands = {
        setViewport() {},
        setBindGroup() {},
        setPipeline: (p: unknown) => pass.pipelines.push(p),
        draw: () => pass.draws++,
        executeBundles: (bundles: GPURenderBundle[]): void => replayBundles(commands, bundles),
        end() {},
      }
      return commands
    },
  } as unknown as GPUCommandEncoder
  const { device, bundles } = fakeDevice()
  return { rt, device, bundles, encoder, passes, computePasses, made, ordinary, direct, tiles }
}
