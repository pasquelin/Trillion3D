import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
import { PT_SCATTER_WGSL } from './surfaceWgsl.ts'
import { PT_RANDOM_WGSL } from './randomWgsl.ts'

/**
 * A PATH, AND WHAT IT KEEPS BETWEEN TWO BOUNCES (`PtState`, a record a pixel of the tile in `ptStates`, 96 bytes): the random sequence, the light it has gathered and its alpha, the
 * albedo and normal the denoiser is given (half floats), the ray it goes on along, its throughput, the roughest lobe it has scattered off (`roughness`: a path that has gone through
 * a rough lobe is held to that roughness by every surface after, where the caustics are approximated), the first scatter it made (`scatter`: the camera's until it has scattered) beside the bit that says this image traced the pixel (`identity.w`, bit 8) and the one that says the path has ended (bit 9: the bounces past the compaction depth go on over a list that still holds it).
 *
 * `ptCreatePath(pixel, samples)` begins the sample of a pixel: its sequence, by the sampler type (a sequence of its own, or one across the image; adaptive sampling seeds each pixel's by the
 * samples it has gathered), the four numbers the reference draws for the pixel's jitter and lens, which keep the dimensions that follow where they are, and a throughput of one.
 */
export const PT_STATE_WGSL = wgslBlock(
  'PT_STATE_WGSL',
  [PT_RANDOM_WGSL, PT_SCATTER_WGSL, PT_MONTE_CARLO_WGSL],
  `struct PtState{identity:vec4u,radiance:vec4f,origin:vec4f,direction:vec4f,throughput:vec4f,aov:vec4u,}
struct PtPath{rand:PtRand,radiance:vec3f,alpha:f32,albedo:vec3f,normal:vec3f,origin:vec3f,direction:vec3f,throughput:vec3f,roughness:f32,scatter:u32,dead:bool,jitter:vec2f,depth:f32,}
fn ptLoadPath(index:u32)->PtPath{
 let s=ptStates[index];
 var p:PtPath;
 p.rand=PtRand(s.identity.x,s.identity.y);
 p.roughness=bitcast<f32>(s.identity.z);
 p.scatter=s.identity.w&0xffu;
 p.dead=((s.identity.w>>9u)&1u)!=0u;
 p.radiance=s.radiance.xyz;
 p.alpha=s.radiance.w;
 p.origin=s.origin.xyz;
 p.depth=s.origin.w;
 p.direction=s.direction.xyz;
 p.throughput=s.throughput.xyz;
 let a=unpack2x16float(s.aov.x);
 let b=unpack2x16float(s.aov.y);
 let c=unpack2x16float(s.aov.z);
 p.albedo=vec3f(a.x,a.y,b.x);
 p.normal=vec3f(b.y,c.x,c.y);
 return p;
}
fn ptStorePath(index:u32,p:PtPath){
 var s:PtState;
 s.identity=vec4u(p.rand.index,p.rand.seed,bitcast<u32>(p.roughness),(p.scatter|(1u<<8u)|(select(0u,1u,p.dead)<<9u)));
 s.radiance=vec4f(p.radiance,p.alpha);
 s.origin=vec4f(p.origin,p.depth);
 s.direction=vec4f(p.direction,0.0);
 s.throughput=vec4f(p.throughput,0.0);
 s.aov=vec4u(pack2x16float(p.albedo.xy),pack2x16float(vec2f(p.albedo.z,p.normal.x)),pack2x16float(p.normal.yz),0u);
 ptStates[index]=s;
}
fn ptCreatePath(pixel:vec2u,samples:u32)->PtPath{
 var p:PtPath;
 let iteration=ptView.image.w;
 let seed=ptView.seeds.x;
 let pixelSeed=pixel.x+pixel.y*65536u;
 if(ptView.flags.z!=0u){
  p.rand=ptRandCreate(pixelSeed,seed-iteration+samples);
 }else if(ptView.seeds.w==1u){
  p.rand=ptRandCreateDiffused(pixel,seed-iteration,iteration,ptView.image.z);
 }else{
  p.rand=ptRandCreate(pixelSeed,seed);
 }
 let draws=ptRand4(&p.rand);
 p.jitter=ptFilterJitter(draws.xy,ptView.sampling.y);
 p.depth=0.0;
 p.throughput=vec3f(1.0);
 p.roughness=0.0;
 p.scatter=PT_SCATTER_CAMERA;
 p.dead=false;
 return p;
}`,
)

/** Bytes of a path's record in `ptStates` (`PtState`). */
export const PT_STATE_BYTES = 96
