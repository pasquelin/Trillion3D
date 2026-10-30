// A view for the denoise's tests: a 12 × 12 target seen by a perspective camera, reverse-Z, near plane 0.1.
export const SHADOW_MAP_DEFAULTS_FOR_TEST = {
  view: {
    view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0],
    width: 12,
    height: 12,
    depth: {} as GPUTextureView,
    normals: {} as GPUTextureView,
  },
}
