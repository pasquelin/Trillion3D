import type { CameraPose } from '../../../../sdk-core/src/index.ts'
import { devicePixels } from '../../engine/common.ts'
import type { MeasuredWorldOptions, Engine } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'
import { hostPoint } from '../../host/scene/graphObjects.ts'

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
      view.position.fromArray(pose.position)
      view.fov = pose.fov
      view.near = pose.near
      view.far = pose.far
      view.aspect = size.width / size.height
      view.lookAt(hostPoint(pose.target[0], pose.target[1], pose.target[2]))
      view.updateProjectionMatrix()
      view.updateMatrixWorld()
      setCapturingSurface(true)
      try {
        return await engine.captureSurfaceView(view, size)
      } finally {
        setCapturingSurface(false)
      }
    },
    resize(width: number, height: number) {
      check()
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
        throw new Error('Invalid viewport size')
      canvas.width = devicePixels(width, options.pixelRatio)
      canvas.height = devicePixels(height, options.pixelRatio)
      // Sizing a canvas blanks it, to the same size too: the engine's image is to be presented.
      engine.canvasResized()
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      viewport[0] = canvas.width
      viewport[1] = canvas.height
    },
  }
}
