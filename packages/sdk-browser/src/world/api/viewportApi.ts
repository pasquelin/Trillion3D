import { isImageSize } from '../../../../math/src/scalar/integers.ts'
import type { CameraPose } from '../../../../sdk-core/src/contracts/base.ts'
import { devicePixels } from '../../engine/common.ts'
import type { MeasuredWorldOptions } from '../session/options.ts'
import type { Engine } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'
import { hostPoint } from '../../host/scene/graphObjects.ts'
import { poseCamera } from '../render/sessionState.ts'

/** The shape a frame is drawn at: the canvas's drawing buffer, its width over its height. */
export const drawnAspect = (canvas: HTMLCanvasElement) => canvas.width / Math.max(1, canvas.height)

/** Sizes the canvas's drawing buffer to a CSS box at the host's ratio (`devicePixels`): at opening
 *  and at every resize, one truncation. */
export function sizeDrawingBuffer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number | undefined,
) {
  canvas.width = devicePixels(width, pixelRatio)
  canvas.height = devicePixels(height, pixelRatio)
}

type Inputs = {
  check: () => void
  engine: Engine
  setCapturingSurface: (value: boolean) => void
  camera: HostCamera
  canvas: HTMLCanvasElement
  viewport: [number, number]
  options: MeasuredWorldOptions
}

export function createExplorerViewportApi(inputs: Inputs) {
  const { check, engine, setCapturingSurface, camera, canvas, viewport, options } = inputs
  return {
    async captureSurfaceView(
      pose: CameraPose,
      size: { width: number; height: number; signal?: AbortSignal },
    ) {
      check()
      // A view of its own, drawn with its material surfaces.
      const view = camera.clone()
      view.aspect = size.width / size.height
      poseCamera(view, pose, hostPoint(0, 0, 0))
      setCapturingSurface(true)
      try {
        return await engine.captureSurfaceView(view, size)
      } finally {
        setCapturingSurface(false)
      }
    },
    resize(width: number, height: number) {
      check()
      if (!isImageSize(width, height)) throw new Error('Invalid viewport size')
      sizeDrawingBuffer(canvas, width, height, options.pixelRatio)
      // Sizing a canvas blanks it, to the same size too: the engine's image is to be presented.
      engine.canvasResized()
      camera.aspect = drawnAspect(canvas)
      camera.updateProjectionMatrix()
      viewport[0] = canvas.width
      viewport[1] = canvas.height
    },
  }
}
