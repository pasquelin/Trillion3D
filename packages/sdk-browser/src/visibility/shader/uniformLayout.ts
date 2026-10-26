import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * The visibility-buffer uniform (`Uniforms`, `VIS_UNIFORMS_WGSL`), the same word for word for both
 * rasters and the resolves; `visibility/passes/uniforms.ts` writes it once per slot. `pixelRatio`
 * is the render pixels per CSS pixel, the scale of a line's width (`lineWgsl.ts`); `mipBias` the
 * texture level offset of a frame drawn below the display (`../../materials/virtual/wgsl.ts`).
 * `near`, `eye`, `forward` and `perspective` (the projection's clip-w weight) place the camera for
 * the tessellation's patches. `clipPlane` is the view's clip plane in the world the clusters are
 * placed in, `dot(xyz, p) + w` at least 0 drawn, all zero for a view that clips nothing
 * (`../../frame/render/viewClip.ts`), which every vertex stage cuts the primitives by
 * (`../../gpu/core/clipDistances.ts`); `clipRoute` is 1 where the cut's cull of the plane is on,
 * the tessellation then dropping a patch that lies behind it (`../tessellation/sightWgsl.ts`).
 * `focal` is the projection's scale on each axis (its first and second diagonal terms), which the
 * rasters take the angle of a pixel's ray to the view axis by, and `depthSpan` the distance an
 * orthographic view's depth runs over, its far less its near, zero in a perspective one
 * (`pixelDepthOffset`, `maskGraphWgsl.ts`).
 * `tessellation` is one where the frame draws the surfaces that name a displacement tessellated
 * (`../tessellation/`), zero where it draws them flat. `pageCount` is the rows the page table holds
 * (the resolve uniform's own): an identifier past it names no row (`visRowIn`).
 */
export const VIS_UNIFORM = fieldLayout('Uniforms', [
  ['viewProj', 'mat4x4f'],
  ['viewport', 'vec2f'],
  ['near', 'f32'],
  ['drawSlot', 'u32'],
  ['indirect', 'u32'],
  ['pixelRatio', 'f32'],
  ['mipBias', 'f32'],
  ['eye', 'vec3f'],
  ['perspective', 'f32'],
  ['forward', 'vec3f'],
  ['tessellation', 'u32'],
  ['clipPlane', 'vec4f'],
  ['clipRoute', 'u32'],
  ['focal', 'vec2f'],
  ['depthSpan', 'f32'],
  ['pageCount', 'u32'],
] as const)

/** The surface resolve's uniform (`ShadeUni`): its camera, viewport and the clusters' count, the cut's pixel
 *  threshold the screen-error view measures against (`diagnosticScreenError`), then the depth
 *  material's ramp (`writeDepthRamp`, `../../camera/depthConvention.ts`) at `depthRamp`,
 *  whether the frame counts the voxel trace's steps (`voxelStepsWgsl.ts`), then what a graph reads
 *  of the view (`../../materials/graph/resolveWgsl.ts`): the camera's place in the world the rows
 *  are placed in and the world's time in seconds —, the image's index the voxels' shading normals are
 *  drawn with (`voxelSampledNormal`) and the wall clock in seconds, which runs on through a pause
 *  (`../../materials/graph/clocks.ts`), then whether an eye's iris has a normal of its own (`irisNormal`, 1 or 0) and whether a clear coat keeps a bottom normal (`clearCoatNormal`, 1 or 0), then whether the alpha holdout is in effect (`holdout`, 1 or 0): a held-out primitive's pixels are then black, then the curve a material's `normalCurvatureToRoughness` takes its roughness by (`normalCurvature`: scale, bias, exponent). */
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
  ['eye', 'vec3f'],
  ['time', 'f32'],
  ['frameIndex', 'u32'],
  ['realTime', 'f32'],
  ['irisNormal', 'u32'],
  ['clearCoatNormal', 'u32'],
  ['holdout', 'u32'],
  ['normalCurvature', 'vec3f'],
] as const)
