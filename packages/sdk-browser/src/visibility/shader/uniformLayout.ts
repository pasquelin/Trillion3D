import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * The visibility-buffer uniform (`Uniforms`, `VIS_UNIFORMS_WGSL`), the same word for word for both
 * rasters and the resolves; `visibility/passes/uniforms.ts` writes it once per slot. `pixelRatio`
 * is the render pixels per CSS pixel, the scale of a line's width (`lineWgsl.ts`); `mipBias` the
 * texture level offset of a frame drawn below the display (`../../materials/virtual/wgsl.ts`).
 * `pageCount` is the drawable rows the binning splits; `near`, `eye`, `forward` and
 * `perspective` (the projection's clip-w weight) place the camera for the cluster split, whose
 * threshold `hardwareEdge` is the view's pixels per unit at depth one divided by
 * `hardwareRasterEdgePixels`, and `softwareRaster` zero when every cluster is hardware's
 * (`../raster/binWgsl.ts`).
 */
export const VIS_UNIFORM = fieldLayout('Uniforms', [
  ['viewProj', 'mat4x4f'],
  ['viewport', 'vec2f'],
  ['near', 'f32'],
  ['pageCount', 'u32'],
  ['drawSlot', 'u32'],
  ['indirect', 'u32'],
  ['selectionOffset', 'u32'],
  ['selectionEnabled', 'u32'],
  ['pixelRatio', 'f32'],
  ['mipBias', 'f32'],
  ['eye', 'vec3f'],
  ['perspective', 'f32'],
  ['forward', 'vec3f'],
  ['hardwareEdge', 'f32'],
  ['softwareRaster', 'u32'],
] as const)

/** The surface resolve's uniform (`ShadeUni`): its camera, viewport and page count, the cut's pixel
 *  threshold the screen-error view measures against (`diagnosticScreenError`), then the depth
 *  material's ramp (`writeDepthRamp`, `../../camera/depthConvention.ts`) at `depthRamp`, and
 *  whether the frame counts the voxel trace's steps (`voxelStepsWgsl.ts`). */
export const SHADE_UNIFORM = fieldLayout('ShadeUni', [
  ['viewProj', 'mat4x4f'],
  ['viewport', 'vec2f'],
  ['pixelRatio', 'f32'],
  ['mipBias', 'f32'],
  ['pageCount', 'u32'],
  ['mode', 'u32'],
  ['feedback', 'u32'],
  ['pixelError', 'f32'],
  ['depthRamp', 'vec4f'],
  ['voxelCounting', 'u32'],
] as const)
