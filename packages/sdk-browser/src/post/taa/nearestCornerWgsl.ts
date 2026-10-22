import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * The nearest of the four corners of a 3×3 (`nearestCorner`), from the depths `d0` to `d3` of its corners
 * in reading order (up-left, up-right, down-left, down-right), the larger a depth the nearer: the corner's
 * offset, each axis ±1, `(1, 1)` where the first of two equal depths wins. The two passes that take the
 * motion of the nearest surface around a texel — the motion blur's flattening, the depth of field's
 * temporal accumulation — read it by this; the second scales it by its reach.
 */
export const NEAREST_CORNER_WGSL = wgslFn(
  'nearestCorner',
  [],
  `fn nearestCorner(d0:f32,d1:f32,d2:f32,d3:f32)->vec2i{
 var offset=vec2i(1);
 var top=1;
 if(d0>d1){top=-1;}
 if(d2>d3){offset.x=-1;}
 if(max(d0,d1)>max(d2,d3)){offset.y=-1;offset.x=top;}
 return offset;
}`,
)
