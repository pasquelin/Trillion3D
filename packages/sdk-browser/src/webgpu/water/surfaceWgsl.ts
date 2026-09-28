/**
 * Surface stage of the water pass: the transmissive items draw with the blend vertex stage and
 * the blend material read (`blendSurface`), and store what they read instead of lighting it — the
 * surface buffer of the opaque resolve, free once that resolve consumed it, plus the hardware
 * depth of the surface. The fullscreen composite (`compositeWgsl.ts`) lights it once
 * per pixel, on the frozen backdrop, whatever the number of surfaces the pixel stacked.
 *
 * The fourth target carries the item's water rank — one-based so that zero means "no water
 * here", as the item record carries it above its flags — and the opacity in its high sixteen
 * bits: the composite reads the material volume at that rank and blends by that opacity. That
 * word never goes to the surface flags, which temporal antialiasing and the composition read
 * after the pass as the opaque resolve left them, nor to a target of its own: it borrows the
 * display colour (`DISPLAY_FORMAT`), which only the composition writes, after the pass, one byte
 * per channel — `unpack4x8unorm` stores each byte exactly, `pack4x8unorm` reads the same word back.
 */
export const WATER_RANK_SHIFT = 16;
/** Transmissive items a scene may carry: the rank counts them in sixteen bits. */
export const WATER_MAX_ITEMS = (1 << WATER_RANK_SHIFT) - 1;
/** The five targets of the stage: the surface buffer, then the virtual-texture feedback. */
export const WATER_SURFACE_WGSL = `
struct WaterOut{@location(0) baseMetal:vec4f,@location(1) normalRough:vec4f,@location(2) emissiveAo:vec4f,@location(3) word:vec4f,@location(4) request:u32,}
@fragment fn fsWater(in:VSOut,@builtin(front_facing) front:bool)->WaterOut{
 let s=blendSurface(in,front);
 let opacity=u32(round(clamp(s.alpha,0.0,1.0)*65535.0));
 return WaterOut(vec4f(s.rgb,s.metal),vec4f(s.N,s.rough),vec4f(s.emissive,s.ao),unpack4x8unorm((in.water&${WATER_MAX_ITEMS}u)|(opacity<<${WATER_RANK_SHIFT}u)),s.request);
}
`;
/** The composite's reading of that fourth word: rank and opacity, as the stage packed them. */
export const WATER_UNPACK_WGSL = `
fn waterWordAt(coord:vec2i)->u32{return pack4x8unorm(textureLoad(waterWord,coord,0));}
fn waterRank(packed:u32)->u32{return (packed&${WATER_MAX_ITEMS}u)-1u;}
fn waterOpacity(packed:u32)->f32{return f32(packed>>${WATER_RANK_SHIFT}u)/65535.0;}
`;
