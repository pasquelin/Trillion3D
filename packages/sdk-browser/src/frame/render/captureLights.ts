import { retire } from '../../gpu/core/frameRetire.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { SIMPLE_HEADER_AT } from '../backend/state/lightBuffer.ts'

/**
 * THE LIGHT BUFFER OF A VIEW THAT IS NOT LIT (`ViewOverrides.lighting`): the scene's buffer copied
 * as it stands, its count of lights and of simple lights cleared. The lighting of the view then walks no light — the
 * fog, the air and the rest of the buffer are the scene's — and what it draws holds what the
 * surfaces emit, with the diffuse the ambient lights through. The main view never reads it.
 */
const COUNT_BYTES = 4
/** The simple lights' header: their count and the bits beside it (`DirectLights.simple`, `simpleBits`), both cleared. */
const SIMPLE_HEADER_BYTES = 8
const COPIES = new WeakMap<object, { of: GPUBuffer; copy: GPUBuffer }>()

/** Copies the light buffer, cleared of its count, ahead of the lighting that reads it
 *  (`unlitLights`). */
export function encodeUnlitLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const source = rt.lights.buffer
  if (!source) return
  let held = COPIES.get(rt.lights)
  if (held?.of !== source) {
    if (held) retire(device, held.copy)
    held = {
      of: source,
      copy: device.createBuffer({
        label: 'Trillion3D unlit light buffer',
        size: source.size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    }
    COPIES.set(rt.lights, held)
  }
  encoder.copyBufferToBuffer(source, 0, held.copy, 0, source.size)
  encoder.clearBuffer(held.copy, 0, COUNT_BYTES)
  // The simple lights follow the scene's in rank: their count is cleared as well, else the view is lit by them.
  encoder.clearBuffer(held.copy, SIMPLE_HEADER_AT, SIMPLE_HEADER_BYTES)
}

/** The light buffer a view that is not lit reads (`encodeUnlitLights`), else the scene's. */
export const unlitLights = (rt: WebgpuPagesRuntime) =>
  COPIES.get(rt.lights)?.copy ?? rt.lights.buffer

/** Gives back the copy, at the session's end. */
export function releaseUnlitLights(rt: WebgpuPagesRuntime) {
  COPIES.get(rt.lights)?.copy.destroy()
  COPIES.delete(rt.lights)
}
