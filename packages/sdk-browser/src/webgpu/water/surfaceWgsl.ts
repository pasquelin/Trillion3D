// The surface stage's WGSL (`rank.ts` says what it stores), imported with the fluids' code
// (`../../fluids/fluidCode.ts`): the core holds the rank alone.
import { WATER_MAX_ITEMS, WATER_RANK_SHIFT } from './rank.ts';

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
