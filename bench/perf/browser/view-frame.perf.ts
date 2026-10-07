import { surfaceColorAttachments } from '../../../packages/sdk-browser/src/webgpu/pages/prepare/attachments.ts'
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'
import { measure, rapport } from '../../core/index.ts'
import { referenceAttachments } from '../../oracles/browser/view-frame.ts'
const DUMMY_TEXTURE = {} as GPUTexture
const buildSurfaces = (): SurfaceBuffer => {
  const views: GPUTextureView[] = [0, 1, 2, 3].map(() => ({}) as GPUTextureView)
  return {
    ...{ version: 1, width: 1, height: 1, allocationBytes: 0 },
    ...{ baseMetal: DUMMY_TEXTURE, normalRough: DUMMY_TEXTURE, emissiveAo: DUMMY_TEXTURE },
    ...{ flags: DUMMY_TEXTURE, subsurface: DUMMY_TEXTURE, subsurfaceView: {} as GPUTextureView },
    ...{ hasEmissiveAo: true, receiver: DUMMY_TEXTURE, receiverView: {} as GPUTextureView },
    ...{ lobes: DUMMY_TEXTURE, lobesView: {} as GPUTextureView },
    views: () => views,
    dispose: () => {},
  }
}
const small = buildSurfaces(),
  large = buildSurfaces()
const disposed: SurfaceBuffer = {
  ...buildSurfaces(),
  views: () => {
    throw new Error('SURFACE_DISPOSED')
  },
}
/** Each target's descriptors, or the error it refused with, in an array the wrapper keeps: the
 *  timed call stores references only, copied untimed by `readAttachments`. */
type Attachments = (GPURenderPassColorAttachment | null)[]
type Descriptors = (Attachments | string)[]
const eachAttachments = (fn: (surfaces: SurfaceBuffer) => Attachments) => {
  const output: Descriptors = []
  return (input: SurfaceBuffer[]) => {
    output.length = input.length
    for (let i = 0; i < input.length; i++) {
      try {
        output[i] = fn(input[i])
      } catch (error) {
        output[i] = error instanceof Error ? error.message : String(error)
      }
    }
    return output
  }
}
const readAttachments = (_: SurfaceBuffer[], output: Descriptors) =>
  output.map((item) =>
    typeof item === 'string'
      ? item
      : item.map((a) => a && { ...a, clearValue: [...(a.clearValue as number[])] }),
  )

const steadyFrames: SurfaceBuffer[] = []
for (let i = 0; i < 2000; i++) steadyFrames.push(small)
const resized = [small, small, large, large, small, disposed, large]

const resAttachments = await measure({
  name: 'surface attachments',
  fichier: 'packages/sdk-browser/src/webgpu/pages/prepare/attachments.ts',
  cas: [
    { name: '2 000 frames without resize', input: steadyFrames, size: 2000 },
    { name: 'resizes and a disposed target', input: resized, size: 7 },
  ],
  calculation: eachAttachments(surfaceColorAttachments),
  expected: eachAttachments(referenceAttachments),
  lecture: readAttachments,
  options: { tours: 100, budgetMs: 1500 },
})

rapport('cadre-vue', [resAttachments], 'F10 yields the exact same descriptors')
