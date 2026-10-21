import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { ToneMapping } from '../../../../sdk-core/src/world/constants/index.ts'
import type { ViewOptions } from './views.ts'
import type { WorldParts } from './worldParts.ts'

/** What a world shows of its view: its canvas, device, scene, controls, camera, curve, exposure,
 *  sharpening. */
export function worldView(parts: WorldParts) {
  const { canvas, device, scene, controls, state, adopt, invalidate, runtime } = parts
  return {
    /** The canvas the world draws into. */ canvas,
    /** A promise that settles once the world holds its WebGPU device. */ ready: device.ready,
    /** The scene: everything added to it is drawn. */ scene,
    /** The mouse and keyboard controller that moves the camera. */ controls,
    /** The camera the image is seen through; set another to switch. */ get camera() {
      return state.camera
    },
    set camera(next: Camera) {
      state.camera = adopt(next)
      controls.follow()
      invalidate()
    },
    /** The curve that brings scene radiance into the display range; ACES by default. */
    get toneMapping() {
      return state.toneMapping
    },
    set toneMapping(curve: ToneMapping) {
      state.toneMapping = curve
      runtime.displayChanged()
    },
    /** Scene exposure, the multiplier the lighting applies before presentation. */
    get exposure() {
      return state.exposure
    },
    set exposure(value: number) {
      state.exposure = value
      runtime.displayChanged()
    },
    /** The tonemapper's sharpening, before the curve, so it sharpens linear light: 0 none,
     *  up to 1 (`SceneEnvironment.sharpness`). */
    get sharpness() {
      return state.sharpness
    },
    set sharpness(value: number) {
      state.sharpness = value
      runtime.displayChanged()
    },
  }
}

/** The world's views beside its main one: one scene, several cameras (`views.ts`). */
export function worldViewMethods({ views, live }: WorldParts) {
  return {
    /** Adds a view of the world's scene: its own camera, drawn into a canvas of its own or over a
     *  rectangle of the world's, each frame after the main image, on the world's one budget.
     *  Everything a camera does not change is the world's and shared: pages, shadows, materials,
     *  physics, clips. @param options - Where it draws, and how (`ViewOptions`).
     *  @example const side = world.addView({ canvas: 'side', camera: camera.perspective() }); */
    addView(options: ViewOptions) {
      live()
      return views.addView(options)
    },
    /** The views added, in their order; the main one is the world itself. */
    get views() {
      return views.list
    },
  }
}
