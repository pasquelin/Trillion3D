/**
 * THE BEER MAP OF THE CAMERA, as the translucent layers read it (`cameraReadWgsl.ts`): the image of the volumes composited with the
 * translucency makes, one image, a map of where the rays of the camera meet extinction and the radiance the volumes lay on them,
 * stacked in the two layers of one half-float 2D array (layer 0 the map, layer 1 the radiance image), at the volumes' own resolution.
 * Published by the frame that made it (`liveShadingFrame.ts`) for the image only, none where it made none; the blend pass binds
 * it or the one-texel stand-in that holds nothing (`cameraStandIn`), and the view says which (`BlendView.volumeCamera`).
 */
export interface CameraMap {
  readonly view: GPUTextureView
  /** The camera's pixels a texel of the map covers, a side. */
  readonly factor: number
}

const published = new WeakMap<object, CameraMap>()

/** The map the last image of `gpu` made, none where it made none. */
export const heterogeneousCameraOf = (gpu: object): CameraMap | undefined => published.get(gpu)

/** Gives the map of the image being drawn, or none (`undefined`). */
export function publishHeterogeneousCamera(gpu: object, map: CameraMap | undefined) {
  if (map) published.set(gpu, map)
  else published.delete(gpu)
}

const stands = new WeakMap<GPUDevice, GPUTextureView>()

/** The one-texel two-layer array a pass that reads no map binds. */
export function cameraStandIn(device: GPUDevice) {
  let view = stands.get(device)
  if (!view) {
    view = device
      .createTexture({
        label: 'Trillion3D heterogeneous volume camera map stand-in',
        size: [1, 1, 2],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView({ dimension: '2d-array' })
    stands.set(device, view)
  }
  return view
}
