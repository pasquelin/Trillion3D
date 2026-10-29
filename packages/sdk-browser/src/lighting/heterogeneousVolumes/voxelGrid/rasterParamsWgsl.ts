import { wgslStruct } from '../../../../../math/src/wgsl/decl.ts'

/** The bytes of the rasterization's parameters (`VgRasterParams`). */
export const VG_RASTER_PARAMS_BYTES = 176

/**
 * THE PARAMETERS OF THE RASTERIZATION OF A VOLUME INTO A GRID, read by the two kernels that make the samples and fold them into the grid:
 * the top level's resolution; the grid it fills (0 the ortho grid, 1 the frustum grid) and, for the ortho grid, its bounds, whether it has an
 * indirection grid and the resolution of one bottom level; the volume's world box; whether the samples are jittered by the blue noise at the
 * frame (mod 8); for the frustum grid the matrix from its view space to the world and the tangent of half its field of view, its near and far
 * depth; the homogeneous threshold (under 0: no aggregation) and the bottom-level cells the grid's buffers hold.
 */
export const VG_RASTER_PARAMS_WGSL = wgslStruct(
  'VgRasterParams',
  [],
  `struct VgRasterParams{
 resolution:vec3i,
 grid:i32,
 boundsMin:vec3f,
 indirection:i32,
 boundsMax:vec3f,
 fixedResolution:i32,
 primitiveMin:vec3f,
 jitter:i32,
 primitiveMax:vec3f,
 frame:u32,
 viewToWorld:mat4x4f,
 // x the tangent of half the field of view across, y the near depth, z the far depth, w the homogeneous threshold.
 frustum:vec4f,
 // x the bottom-level cells the buffers hold.
 pool:vec4u,
}`,
)
