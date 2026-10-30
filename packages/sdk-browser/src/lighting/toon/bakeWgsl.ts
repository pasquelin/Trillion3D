/**
 * THE BAKE OF A TOON PROFILE'S IMAGES into the patterns the lights read (`toonProfile/rows.ts`): a texel of the `bake.at.y` (the resolution) a side
 * is the image sampled at level 0, bilinear, repeating, at the centre of the texel taken from a ring of one texel around the
 * `bake.at.y` less two the image is spread over — so that the ring holds the image's opposite edge and a pattern that repeats filters across its seam.
 * - `bakeOffsets`: the diffuse offset image's red and the specular offset image's green, 16 bits each, in one word.
 * - `bakeHatching`: the hatching image's four channels, 8 bits each, in one word.
 * The word of the texel is `bake.at.x` (the pattern's first word in the toon buffer) plus its row and column.
 */
export const TOON_BAKE_WGSL = `
struct Bake{at:vec4u,}
@group(0) @binding(0) var<uniform> bake:Bake;
@group(0) @binding(1) var first:texture_2d<f32>;
@group(0) @binding(2) var second:texture_2d<f32>;
@group(0) @binding(3) var wrapped:sampler;
@group(0) @binding(4) var<storage,read_write> words:array<u32>;
fn bakeUv(id:vec2u)->vec2f{return (vec2f(id)+0.5-1.0)/f32(bake.at.y-2u);}
@compute @workgroup_size(8,8) fn bakeOffsets(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(bake.at.y))){return;}
 let uv=bakeUv(id.xy);
 let diffuse=textureSampleLevel(first,wrapped,uv,0.0).x;
 let specular=textureSampleLevel(second,wrapped,uv,0.0).y;
 words[bake.at.x+id.y*bake.at.y+id.x]=pack2x16unorm(vec2f(diffuse,specular));
}
@compute @workgroup_size(8,8) fn bakeHatching(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(bake.at.y))){return;}
 words[bake.at.x+id.y*bake.at.y+id.x]=pack4x8unorm(textureSampleLevel(first,wrapped,bakeUv(id.xy),0.0));
}`
