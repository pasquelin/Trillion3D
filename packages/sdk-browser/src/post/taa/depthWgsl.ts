import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The most a texel's depth error is coded against: 64 pixel depth errors, eight bits over it. */
const DEPTH_ERROR_RANGE = 64

/**
 * Depths as the temporal passes measure them, from the projection's depth terms in the pass uniform
 * (`view.depth`, `view.radius`, `bindingsWgsl.ts`); any projection the engine draws with — the
 * reversed infinite perspective, where a device depth is `near / distance`, or an orthographic one.
 * - `sceneDepthOf`: the distance along the view axis of a device depth `z`, solving the
 *   projection's `z / w` for the view-space coordinate; a far depth of zero stays finite.
 * - `deviceZOf`: the inverse, the device depth of a scene depth.
 * - `pixelRadiusAt`: a render pixel's world radius at a scene depth.
 * - `pixelDeviceZError`: how far the device depth moves when the surface moves away by a pixel's
 *   diameter at its depth — the depth a pixel's own size makes uncertain.
 * - `encodeDepthError`, `decodeDepthError`: a parallax depth error in eight bits, relative to 64 such
 *   pixel errors at a reference depth (`DEPTH_ERROR_RANGE`), rounded up.
 */
export const DEPTH_WGSL = wgslBlock(
  'DEPTH_WGSL',
  [],
  `
fn sceneDepthOf(z:f32)->f32{
 let d=z*view.depth.z-view.depth.x;
 return abs((view.depth.y-z*view.depth.w)/select(d,1e-30,abs(d)<1e-30));
}
fn deviceZOf(depth:f32)->f32{
 let t=view.radius.z*depth;
 return (view.depth.x*t+view.depth.y)/(view.depth.z*t+view.depth.w);
}
fn pixelRadiusAt(depth:f32)->f32{return view.radius.x*depth+view.radius.y;}
fn pixelDeviceZError(z:f32)->f32{
 let depth=sceneDepthOf(z);
 return abs(deviceZOf(pixelRadiusAt(depth)*2.0+depth)-z);
}
fn encodeDepthError(prevClosestZ:f32,parallaxError:f32)->u32{
 let pixelError=${DEPTH_ERROR_RANGE}.0*pixelDeviceZError(prevClosestZ);
 return u32(ceil(saturate(parallaxError/max(pixelError,1e-30))*255.0));
}
fn decodeDepthError(prevClosestZ:f32,code:u32)->f32{
 return pixelDeviceZError(prevClosestZ)*f32(code)*${DEPTH_ERROR_RANGE / 255};
}`,
)
