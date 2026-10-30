import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { computeTextureEntry, computeUniformEntry } from '../../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { uniformBuffer } from '../../../../gpu/core/uniformBlock.ts'
import { writeChanged } from '../../../../gpu/core/writeChanged.ts'
import { FULLSCREEN_VERTEX } from '../../../../gpu/shader/fullscreenTriangle.ts'
import { DISPLAY_FORMAT } from '../../../../scene/targetFormats.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../../deferred/fullscreen.ts'
import type { TileRect } from '../../visualizeModes.ts'
import { sceneInside } from '../sceneVisualizeWgsl.ts'
import { HARDWARE_RADIANCE_FORMAT } from './answerWgsl.ts'
import { HARDWARE_PARAMS } from './layout.ts'
import { HARDWARE_HIT_FORMAT } from './traceWgsl.ts'

const LABEL = 'Trillion3D debug scene visualization draw'

/** The draw that lays the radiance the kernels wrote over the display: the pixels of the draw's rect, the corners of a tile rounded. */
const BLIT_WGSL = wgslProgram(
  `${HARDWARE_PARAMS.wgsl}
@group(0) @binding(0) var<uniform> scene:HardwareParams;
@group(0) @binding(1) var shown:texture_2d<f32>;
@fragment fn hardwareBlit(@builtin(position) at:vec4f)->@location(0) vec4f{
 let local=at.xy-scene.tile.xy;
 if(!sceneInside(local)){discard;}
 return textureLoad(shown,vec2i(min(local,vec2f(scene.size.xy)-vec2f(1.0))),0);
}`,
  [sceneInside, FULLSCREEN_VERTEX],
)

const blitOf = oncePerDevice((device: GPUDevice) => {
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeUniformEntry(0, undefined, FRAGMENT),
      computeTextureEntry(1, 'float', '2d', FRAGMENT),
    ],
  })
  const module = device.createShaderModule({ label: LABEL, code: BLIT_WGSL })
  return {
    layout,
    draw: preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        layout,
        'hardwareBlit',
        [{ format: DISPLAY_FORMAT }],
        LABEL,
      ),
    ).ask(),
  }
})

/**
 * WHAT THE TRIANGLE TRACE OF THE SCENE VIEW WRITES TO, kept between images: the hits' texture and the radiance texture of the size of the draw (made again when it changes), a parameters' uniform for each draw of
 * an image, and the blit that lays the radiance over the display. The kernels of both the trace and the dedicated reflection rays view (`../dedicatedRays.ts`) write the radiance.
 */
export function createHardwareTarget(device: GPUDevice) {
  const params: GPUBuffer[] = []
  let size: readonly [number, number] = [0, 0]
  let radiance: GPUTexture | undefined
  let hits: GPUTexture | undefined
  const texture = (
    label: string,
    format: GPUTextureFormat,
    [width, height]: readonly [number, number],
  ) =>
    device.createTexture({
      label: `${LABEL} ${label}`,
      size: [width, height],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  const free = () => {
    radiance?.destroy()
    hits?.destroy()
    radiance = hits = undefined
  }
  return {
    /** The uniform of draw number `draw`, written with `words`. */
    paramsOf(draw: number, words: Uint32Array<ArrayBuffer>) {
      const buffer = (params[draw] ??= uniformBuffer(
        device,
        `${LABEL} parameters ${draw}`,
        HARDWARE_PARAMS.words * 4,
      ))
      writeChanged(device, buffer, words, 0, words.length)
      return buffer
    },
    /** The textures for a draw `drawSize` pixels across and down; the hits' only where `withHits`. */
    texturesOf(drawSize: readonly [number, number], withHits: boolean) {
      if (size[0] !== drawSize[0] || size[1] !== drawSize[1]) {
        free()
        size = drawSize
      }
      radiance ??= texture('radiance', HARDWARE_RADIANCE_FORMAT, size)
      if (withHits) hits ??= texture('hits', HARDWARE_HIT_FORMAT, size)
      return { radiance, hits }
    },
    /** Whether the blit is compiled. */
    get ready() {
      return !!blitOf(device).draw.get()
    },
    /** Lays the radiance over `rect` of `target`, by the uniform `parameters`, in a pass of its own. */
    blit(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      rect: TileRect,
      parameters: GPUBuffer,
    ) {
      const { layout, draw } = blitOf(device)
      const pipeline = draw.get()
      if (!pipeline || !radiance) return
      const pass = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setViewport(rect.x, rect.y, rect.width, rect.height, 0, 1)
      pass.setScissorRect(rect.x, rect.y, rect.width, rect.height)
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: parameters } },
            { binding: 1, resource: radiance.createView() },
          ],
        }),
      )
      pass.draw(3)
      pass.end()
    },
    dispose() {
      free()
      for (const buffer of params) buffer.destroy()
    },
  }
}

/** The target of the scene view's draws (`createHardwareTarget`). */
export type HardwareTarget = ReturnType<typeof createHardwareTarget>
