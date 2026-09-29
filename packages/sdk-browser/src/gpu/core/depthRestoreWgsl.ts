/** Exact depth texel restore shared by shadow pages and cropped water initialization.
 * Source and destination use the same pixel coordinates and depth32float representation. */
export const depthRestoreWgsl = (group: number) => `
@group(${group}) @binding(0) var layer:texture_depth_2d;
@fragment fn restore_fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{
 return textureLoad(layer,vec2i(p.xy),0);
}
`;
