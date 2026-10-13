import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * The visibility-buffer uniform (`Uniforms`, `VIS_UNIFORMS_WGSL`), the same word for word for both
 * rasters and the resolves; `webgpu/visibility/uniforms.ts` writes it once per slot. `pixelRatio`
 * is the render pixels per CSS pixel, the scale of a line's width (`lineWgsl.ts`); `mipBias` the
 * texture level offset of a frame drawn below the display (`../../webgpu/tile/wgsl.ts`).
 */
export const VIS_UNIFORM = fieldLayout('Uniforms', [
  ['viewProj', 'mat4x4f'],
  ['viewport', 'vec2f'],
  ['computeSpan', 'f32'],
  ['pageCount', 'u32'],
  ['drawSlot', 'u32'],
  ['indirect', 'u32'],
  ['selectionOffset', 'u32'],
  ['selectionEnabled', 'u32'],
  ['pixelRatio', 'f32'],
  ['mipBias', 'f32'],
] as const)

/** The surface resolve's uniform (`ShadeUni`): its camera, viewport and page count, then the depth
 *  material's ramp (`writeDepthRamp`, `../../camera/depthConvention.ts`) at `depthRamp`. */
export const SHADE_UNIFORM = fieldLayout('ShadeUni', [
  ['viewProj', 'mat4x4f'],
  ['viewport', 'vec2f'],
  ['pixelRatio', 'f32'],
  ['mipBias', 'f32'],
  ['pageCount', 'u32'],
  ['mode', 'u32'],
  ['feedback', 'u32'],
  ['depthRamp', 'vec4f'],
] as const)
