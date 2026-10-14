import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The slope of a surface along one axis of a depth image, in depth per pixel, from the depth `z`
 * a pixel holds and the two before it and after it (`before`, `after`, then `farBefore`,
 * `farAfter`): read on a side whose two pixels continue the surface — the step into the pixel
 * differs from the step beyond it by less than that step: a plane makes them equal, where a
 * silhouette makes the first a jump that the background beyond does not continue —; of two such
 * sides, the straighter; none when neither side continues (a wire, a bar, a far part one pixel
 * wide). The one rule of every reader of a depth's plane: the plane the depth pyramid keeps at each
 * pixel, where a reflected ray meets it (`../../gpu/hiz/shader.ts`).
 */
export const SURFACE_SLOPE_WGSL = wgslBlock(
  'SURFACE_SLOPE_WGSL',
  [],
  `fn surfaceSlopeOf(z:f32,before:f32,after:f32,farBefore:f32,farAfter:f32)->f32{
 let into=vec2f(z-before,after-z);
 let beyond=vec2f(before-farBefore,farAfter-after);
 let bend=abs(into-beyond);let continues=bend<abs(beyond);
 if(continues.x&&(!continues.y||bend.x<=bend.y)){return into.x;}
 return select(0.0,into.y,continues.y);
}`,
)
