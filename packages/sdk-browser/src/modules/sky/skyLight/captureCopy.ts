import { drawFullscreenTriangle } from '../../../gpu/shader/fullscreenTriangle.ts'
import {
  lowerHemisphereOf,
  type SkyLightPart,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { COPY_LAYOUT } from './copyWgsl.ts'
import { writeBlock } from './captureInputs.ts'
import { BLOCK_STRIDE } from './layout.ts'
import type { SkyLightTargets } from './targets.ts'

/** The words of the copy's block, read as floats and as unsigned integers. */
export function createCopyWords() {
  const words = new ArrayBuffer(COPY_LAYOUT.words * 4)
  return { floats: new Float32Array(words), uints: new Uint32Array(words) }
}

/** The group of the copy's block over the targets' buffer, bound at a dynamic offset
 *  (`FaceCopy.block`). */
export const copyBlockGroup = (device: GPUDevice, layout: GPUBindGroupLayout, t: SkyLightTargets) =>
  device.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: t.blocks.copy, size: COPY_LAYOUT.words * 4 } }],
  })

/** What one face's copy is made of. */
export interface FaceCopy {
  /** None while it is not compiled: the face is not drawn. */
  readonly pipeline: GPURenderPipeline | undefined
  /** The group the pipeline reads its source from (group 0). */
  readonly source: GPUBindGroup
  /** The group of the copy's block (group 1), bound at the face's slot. */
  readonly block: GPUBindGroup
  /** The sine and the cosine of the angle the face's directions are turned about the up axis by. */
  readonly turn: readonly [number, number]
  /** The factor the copied colour is multiplied by (`scale` of the block). */
  readonly scale: readonly [number, number, number, number]
}

/** Face `face` of the captured cube written by `copy`: the block's slot of the face, then the
 *  pass over the face's target, cleared to opaque black. */
export function copyFacePass(
  device: GPUDevice,
  words: ReturnType<typeof createCopyWords>,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  light: SkyLightPart['light'],
  face: number,
  copy: FaceCopy,
) {
  const { at } = COPY_LAYOUT
  words.uints.set([face, light.lowerHemisphereIsSolidColor ? 1 : 0, 0, 0], at.face)
  words.floats.set([copy.turn[0], copy.turn[1], 1 / t.width, 0], at.rotation)
  words.floats.set(lowerHemisphereOf(light), at.lower)
  words.floats.set(copy.scale, at.scale)
  const offset = face * BLOCK_STRIDE
  writeBlock(device, t.blocks.copy, offset, words.floats)
  const descriptor: GPURenderPassDescriptor = {
    label: 'Trillion3D sky light copy',
    colorAttachments: [
      {
        view: t.faceTargets[face],
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      },
    ],
  }
  drawFullscreenTriangle(
    encoder,
    descriptor,
    copy.pipeline,
    [copy.source, copy.block],
    undefined,
    undefined,
    [offset],
  )
}
