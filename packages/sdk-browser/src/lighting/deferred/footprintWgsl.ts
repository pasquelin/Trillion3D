/**
 * WHERE A PIXEL'S SHADOW LEVEL COMES FROM (#1363): its centre WITHOUT the TAA jitter — the world
 * point it holds there, and its footprint, the world distance to its right neighbour at that
 * depth. The one reading of them the resolve (`surfaceWgsl.ts`) and the per-pixel demand
 * (`../../webgpu/shadow/demandWgsl.ts`) share, so the level a pixel reads is the level it asked
 * for, and the same every jitter phase: the reference engine's virtual shadow maps pick a receiver's level from
 * where it lies, never from the sample the jitter drew. Requires `depth`, `view` and `worldAt`
 * (`WORLD_AT_WGSL`).
 *
 * The jitter moves the image by `view.jitter.xy` pixels (`shadowJitterWords`): the pixel's
 * unjittered centre lies there in this image. A receiver's plane has an NDC depth affine across
 * the screen — `1/w` is, and a projected depth is affine in `1/w` —, so its depth there is the
 * depth held, moved along the plane's slope. On each axis the slope is taken on the side of the
 * neighbour nearer in depth: across a silhouette, the pixel's own surface. With no jitter
 * (`view.jitter.xy` zero), the point is the one the pixel holds and the footprint develop's, to
 * the bit.
 */
export const PIXEL_FOOTPRINT_WGSL = `
struct PixelLevel{footprint:f32,unjitter:vec3f,}
fn unjitteredDepth(coord:vec2i,z:f32)->f32{
 let last=vec2i(view.viewport.xy)-vec2i(1);
 let l=textureLoad(depth,max(coord-vec2i(1,0),vec2i(0)),0);let r=textureLoad(depth,min(coord+vec2i(1,0),last),0);
 let u=textureLoad(depth,max(coord-vec2i(0,1),vec2i(0)),0);let d=textureLoad(depth,min(coord+vec2i(0,1),last),0);
 let gx=select(r-z,z-l,abs(z-l)<abs(r-z));let gy=select(d-z,z-u,abs(z-u)<abs(d-z));
 return z+dot(view.jitter.xy,vec2f(gx,gy));
}
/** The footprint of pixel \`pixel\` (at \`coord\`, depth \`z\`, world point \`P\`) at its unjittered
 *  centre, and that centre's world point less \`P\`: \`shadowFootprint\`, \`shadowUnjitter\`. */
fn pixelLevel(coord:vec2i,pixel:vec2f,z:f32,P:vec3f)->PixelLevel{
 let centre=pixel+view.jitter.xy;let held=unjitteredDepth(coord,z);
 let at=worldAt(centre,held);
 return PixelLevel(length(worldAt(centre+vec2f(1.0,0.0),held)-at),at-P);
}`;
