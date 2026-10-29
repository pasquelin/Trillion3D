import { readHizSetting } from '../../../../../sdk-core/src/contracts/hizOptions.ts'
import {
  drawScreenPass,
  screenPassGroup,
  screenPassPipeline,
} from '../../../diagnostic/screenPass.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { chainReady } from '../../deferred/fullscreen.ts'
import { LIGHT_GRID_DEBUG_WGSL } from './gridDebugWgsl.ts'

const PASS = 'Trillion3D light grid view'
/** The words of the pass's uniform. */
const PARAM_WORDS = 8

interface GridDebugState {
  readonly pipeline: ReturnType<typeof screenPassPipeline>
  readonly params: GPUBuffer
  readonly words: Uint32Array<ArrayBuffer>
}
const states = new WeakMap<WebgpuPagesRuntime, GridDebugState>()

/** Gives the pass of a runtime back. */
export function disposeLightGridDebug(rt: WebgpuPagesRuntime) {
  states.get(rt)?.params.destroy()
  states.delete(rt)
}

/**
 * THE LIGHT GRID VIEW (`lightGridDebug`, `lightGridDebugMaxThreshold`, `lightGridDebugSlice`) over the display image, from the grid this image listed (`lighting/tiles/`): nothing is drawn
 * while the view is off, no light lists were built, or the pass compiles.
 */
export function encodeLightGridDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu, lights } = rt
  const mode = readHizSetting(rt, 'lightGridDebug')
  const tiles = lights.tiles
  if (!mode || !tiles?.buffer || !lights.lightsActive || !gpu.displayView || !gpu.depthView)
    return disposeLightGridDebug(rt)
  let state = states.get(rt)
  if (!state)
    states.set(
      rt,
      (state = {
        pipeline: screenPassPipeline(device, PASS, LIGHT_GRID_DEBUG_WGSL, 'fsLightGrid'),
        params: device.createBuffer({
          label: PASS,
          size: PARAM_WORDS * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        words: new Uint32Array(PARAM_WORDS),
      }),
    )
  if (!chainReady(state.pipeline)) return
  const [width, height] = gpu.displaySize
  const slice = readHizSetting(rt, 'lightGridDebugSlice')
  state.words.set([
    width,
    height,
    tiles.tilesX,
    tiles.tilesY,
    mode,
    readHizSetting(rt, 'lightGridDebugMaxThreshold'),
    slice >>> 0,
    lights.lightsActive,
  ])
  device.queue.writeBuffer(state.params, 0, state.words)
  const pipeline = state.pipeline.get()!
  drawScreenPass(encoder, PASS, pipeline, gpu.displayView, [
    screenPassGroup(device, pipeline, [
      { buffer: state.params },
      gpu.depthView,
      { buffer: tiles.buffer },
    ]),
  ])
}
