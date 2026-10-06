/**
 * Where a water pixel reads its shadows (#1412): the point, the side its normal faces and the
 * footprint the composite lights it at (`compositeWgsl.ts`, `waterColor`). The host declares the
 * deferred view (`view`) and `worldAt`.
 */
export const WATER_SHADOW_READ_WGSL = `/** The pixel's footprint at its point \`P\`, depth \`z\`: one pixel across at that depth. */
fn waterShadowFootprint(pixel:vec2f,z:f32,P:vec3f)->f32{return length(worldAt(pixel+vec2f(1.0,0.0),z)-P);}
/** The direction from \`P\` to the eye, under any projection. */
fn waterViewDirection(P:vec3f)->vec3f{return normalize(view.camera.xyz-P*view.camera.w);}
/** Normal \`N\` turned to the side \`V\` looks from: a single-sided surface, or a mesh with no normal
 *  attribute, can arrive turned the wrong way. */
fn waterFacing(N:vec3f,V:vec3f)->vec3f{return select(-N,N,dot(N,V)>0.0);}`
