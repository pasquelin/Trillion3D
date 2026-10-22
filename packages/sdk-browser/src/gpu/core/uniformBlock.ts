import { wordViews } from './wordViews.ts'
import { writeChanged } from './writeChanged.ts'

/**
 * A uniform buffer of `bytes` bytes and the words it is written from — one image of them, read as
 * unsigned, signed and float (`wordViews`) —: `send` copies to the buffer the words that changed
 * since the last (`writeChanged`), none when none did. A pass that keeps its parameters in one
 * block fills the words it computes each image and sends them; an image allocates nothing. `also`
 * adds usage flags to the buffer's own (`COPY_SRC` for one a pass copies from).
 */
export function uniformBlock(device: GPUDevice, label: string, bytes: number, also = 0) {
  const buffer = device.createBuffer({
    label,
    size: bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | also,
  })
  const words = wordViews(new ArrayBuffer(bytes))
  return { buffer, words, send: () => writeChanged(device, buffer, words.u, 0, words.u.length) }
}

/** A uniform block (`uniformBlock`). */
export type UniformBlock = ReturnType<typeof uniformBlock>
