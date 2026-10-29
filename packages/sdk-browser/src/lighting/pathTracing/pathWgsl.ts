import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
import { PT_SCATTER_WGSL } from './surfaceWgsl.ts'
import { PT_RANDOM_WGSL } from './randomWgsl.ts'

/**
 * A PATH, AND WHAT IT KEEPS BETWEEN TWO BOUNCES (`PtState`, a record a pixel of the tile in `ptStates`, 128 bytes): the random sequence, the light it has gathered and its alpha, the
 * albedo and normal the denoiser is given (half floats), the ray it goes on along, its throughput, the roughest lobe it has scattered off (`roughness`: a path that has gone through
 * a rough lobe is held to that roughness by every surface after, where the caustics are approximated), the first scatter it made (`scatter`: the camera's until it has scattered) beside the bit that says this image traced the pixel (`identity.w`, bit 8) and the one that says the path has ended (bit 9: the bounces past the compaction depth go on over a list that still holds it), then the order of multiple scattering the cloud event chosen in the bounce stands for (bits 10 and 11: 0 the event as the medium holds it, else the octave of the cloud's approximation), then the throughput the path had where the bounce's walk through the volume began (`segment`, in the three words the direction, the throughput and the aov keep free: the stretch of the volume itself is the ray's, found again from the hit, so that the lamps can light the volume by a point drawn on it, `pathTracingVolumeMISMode`), then the reservoir of the traced atmosphere (the scattering event chosen so far in the bounce: its place and throughput, the random number and the weights the choice has used), which `ptLoadAir` and `ptStoreAir` move apart from the rest, for the programs where the air is traced. It stays in the record: a buffer of its own would be a ninth storage buffer of the finish, past the limit of eight.
 *
 * `ptCreatePath(pixel, samples)` begins the sample of a pixel: its sequence, by the sampler type (a sequence of its own, or one across the image; adaptive sampling seeds each pixel's by the
 * samples it has gathered), the four numbers the reference draws for the pixel's jitter and lens, which keep the dimensions that follow where they are, and a throughput of one.
 */
export const PT_STATE_WGSL = wgslBlock(
  'PT_STATE_WGSL',
  [PT_RANDOM_WGSL, PT_SCATTER_WGSL, PT_MONTE_CARLO_WGSL],
  `struct PtState{identity:vec4u,radiance:vec4f,origin:vec4f,direction:vec4f,throughput:vec4f,aov:vec4u,event:vec4f,payload:vec4f,}
struct PtPath{rand:PtRand,radiance:vec3f,alpha:f32,albedo:vec3f,normal:vec3f,origin:vec3f,direction:vec3f,throughput:vec3f,roughness:f32,scatter:u32,dead:bool,jitter:vec2f,depth:f32,eventPosition:vec3f,ris:f32,eventThroughput:vec3f,risSum:f32,octave:u32,segment:vec3f,}
fn ptLoadPath(index:u32)->PtPath{
 let s=ptStates[index];
 var p:PtPath;
 p.rand=PtRand(s.identity.x,s.identity.y);
 p.roughness=bitcast<f32>(s.identity.z);
 p.scatter=s.identity.w&0xffu;
 p.dead=((s.identity.w>>9u)&1u)!=0u;
 p.octave=(s.identity.w>>10u)&3u;
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
 p.segment=vec3f(s.direction.w,s.throughput.w,bitcast<f32>(s.aov.w));
 return p;
}
/** The traced air's reservoir, read and written only by the programs where the air is traced (the other paths neither load nor store it). */
fn ptLoadAir(index:u32,p:ptr<function,PtPath>){
 let s=ptStates[index];
 (*p).eventPosition=s.event.xyz;
 (*p).ris=s.event.w;
 (*p).eventThroughput=s.payload.xyz;
 (*p).risSum=s.payload.w;
}
fn ptStoreAir(index:u32,p:PtPath){
 ptStates[index].event=vec4f(p.eventPosition,p.ris);
 ptStates[index].payload=vec4f(p.eventThroughput,p.risSum);
}
fn ptStorePath(index:u32,p:PtPath){
 ptStates[index].identity=vec4u(p.rand.index,p.rand.seed,bitcast<u32>(p.roughness),(p.scatter|(1u<<8u)|(select(0u,1u,p.dead)<<9u)|(p.octave<<10u)));
 ptStates[index].radiance=vec4f(p.radiance,p.alpha);
 ptStates[index].origin=vec4f(p.origin,p.depth);
 ptStates[index].direction=vec4f(p.direction,p.segment.x);
 ptStates[index].throughput=vec4f(p.throughput,p.segment.y);
 ptStates[index].aov=vec4u(pack2x16float(p.albedo.xy),pack2x16float(vec2f(p.albedo.z,p.normal.x)),pack2x16float(p.normal.yz),bitcast<u32>(p.segment.z));
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
export const PT_STATE_BYTES = 128
