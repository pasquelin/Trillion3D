// Page of the no-WebGPU proof: a world created on a page whose `navigator` offers no WebGPU, what
// its `ready` settles with, and whether its canvas stayed untouched.
import { createWorld } from '../../../packages/sdk-browser/src/world/core/world.ts'

export async function execute() {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:320px;height:240px;display:block'
  document.body.append(canvas)
  const world = createWorld(canvas)
  let code: string | null = null,
    message: string | null = null
  try {
    await world.ready
  } catch (error) {
    code = (error as { code?: string }).code ?? null
    message = String(error)
  }
  world.dispose()
  // A canvas that once handed out a context never hands out a 2D one.
  const untouched = canvas.getContext('2d') !== null
  canvas.remove()
  return { webgpu: 'gpu' in navigator && navigator.gpu !== undefined, code, message, untouched }
}
