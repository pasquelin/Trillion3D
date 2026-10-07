import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { WORLD_AT_WGSL } from './worldAtWgsl.ts'

/**
 * WHERE A PIXEL'S SHADOW LEVEL COMES FROM: its centre WITHOUT the TAA jitter — the world
 * point it holds there, and its footprint, the world distance to its right neighbour at that
 * depth. The one reading of them the resolve (`surfaceWgsl.ts`) and the per-pixel demand
 * (`../../vsm/markingWgsl.ts`) share, so the level a pixel reads is the level it asked
 * for, and the same every jitter phase: the virtual shadow maps pick a receiver's level from
 * where it lies, never from the sample the jitter drew. Requires `depth` and `view`; lists `worldAt`
 * (`WORLD_AT_WGSL`).
 *
 * The jitter moves the image by `view.jitter.xy` pixels (`shadowJitterWords`): the pixel's
 * unjittered centre lies there in this image. A receiver's plane has an NDC depth affine across
 * the screen — `1/w` is, and a projected depth is affine in `1/w` —, so its depth there is the
 * depth held, moved along the plane's slope. On each axis the slope is read on a side whose two
 * pixels continue the surface (`surfaceSlope`): the step into the pixel differs from the step
 * beyond it by less than that step — a plane makes them equal, where a silhouette makes the first
 * a jump that the background beyond does not continue —; of two such sides, the straighter. On an
 * axis neither side continues — a wire, a bar or a far part one pixel wide, background on both
 * sides —, the slope is none: the depth held, never a jump across the background. With no jitter
 * (`view.jitter.xy` zero), the point is the one the pixel holds and the footprint is the jittered
 * sample's, to the bit.
 */
export const PIXEL_FOOTPRINT_WGSL = wgslBlock(
  'PIXEL_FOOTPRINT_WGSL',
  [WORLD_AT_WGSL],
  `
/** The depth held at \`coord + k·axis\`, clamped to the image. */
fn footprintDepth(coord:vec2i,axis:vec2i,k:i32)->f32{
 return textureLoad(depth,clamp(coord+axis*k,vec2i(0),vec2i(view.viewport.xy)-vec2i(1)),0);
}
/** The slope of the surface at \`coord\` (depth \`z\`) along \`axis\`, from a side whose two pixels
 *  continue it, the straighter of two; none when neither does. */
fn surfaceSlope(coord:vec2i,axis:vec2i,z:f32)->f32{
 let before=footprintDepth(coord,axis,-1);let after=footprintDepth(coord,axis,1);
 let into=vec2f(z-before,after-z);
 let beyond=vec2f(before-footprintDepth(coord,axis,-2),footprintDepth(coord,axis,2)-after);
 let bend=abs(into-beyond);let continues=bend<abs(beyond);
 if(continues.x&&(!continues.y||bend.x<=bend.y)){return into.x;}
 return select(0.0,into.y,continues.y);
}
fn unjitteredDepth(coord:vec2i,z:f32)->f32{
 let slope=vec2f(surfaceSlope(coord,vec2i(1,0),z),surfaceSlope(coord,vec2i(0,1),z));
 return z+dot(view.jitter.xy,slope);
}
/** The footprint of pixel \`pixel\` (at \`coord\`, depth \`z\`, world point \`P\`) at its unjittered
 *  centre (\`shadowFootprint\`). An image the TAA does not jitter holds its centre: no neighbour is
 *  read, and \`P\` is the point. */
fn pixelFootprint(coord:vec2i,pixel:vec2f,z:f32,P:vec3f)->f32{
 if(all(view.jitter.xy==vec2f(0.0))){return length(worldAt(pixel+vec2f(1.0,0.0),z)-P);}
 let centre=pixel+view.jitter.xy;let held=unjitteredDepth(coord,z);
 let at=worldAt(centre,held);
 return length(worldAt(centre+vec2f(1.0,0.0),held)-at);
}`,
)
