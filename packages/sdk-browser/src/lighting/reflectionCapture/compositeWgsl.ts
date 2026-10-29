import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { SKY_CUBE_WGSL } from '../../modules/sky/skyLight/cubeWgsl.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'
import {
  CAPTURE_DIFFUSE_LEAST_REACH,
  CAPTURE_DIFFUSE_MIPS_FROM_LAST,
  CAPTURE_NORMAL_ADJUST,
  MAX_REFLECTION_CAPTURES,
} from './layout.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'

/**
 * WHAT A PROGRAM READS OF THE REFLECTION CAPTURES: the cube array they were captured into, a sampler, and the block of their records
 * (`records.ts`). `reflectionCapturesAt(P, N, R, roughness, wantSpecular, wantDiffuse)` is the local light a surface at `P` of normal `N` reflecting along `R`
 * takes from the captures that reach it, under the operator the reference composites them with:
 * - the captures in the block's order (the smallest first, `reflectionCaptureSorted`), each read where `P` is inside its reach — a sphere
 *   by its radius, a box by the sphere that holds it — until what they let through is under a thousandth;
 * - the vector the cube is read along is the ray intersected with the capture's shape: a sphere (`sphereCaptureVector`, fading from 0.6
 *   of the radius to its edge) or a box (`boxCaptureVector`, fading over the box's transition inside its faces), taken from the capture's
 *   own point, offset included. The box's fade is by the Euclidean distance to the shrunken box; the reference sums the three axes'
 *   distances, which makes the fade follow the diagonal;
 * - the mip is the roughness's (`roughnessMip`, the sky light's law, which the reference's reflection captures share), the colour is
 *   multiplied by the capture's brightness, its fade and its weight left; `rgb` is the sum, `a` what the captures let through, which
 *   the sky light takes (the reference's `ImageBasedReflections`, started at 1);
 * - with the block's diffuse flag, the same loop reads each cube along the normal, at the mip of 8 texels, adjusting the distance to
 *   the capture along the normal by half a metre (less light leaks through a thin wall) and the box lookup's reach to ten metres at
 *   least, and the loop stops on the diffuse weight left (`diffuse`, the same two-part answer).
 * Without a capture, `rgb` is zero and `a` is one.
 */
export interface ReflectionCaptureBindings {
  readonly group: number
  /** The cube array of the captures, every mip. */
  readonly cube: number
  /** The trilinear sampler. */
  readonly sampler: number
  /** The block of the records, a uniform. */
  readonly block: number
}

const STRUCTS = `struct ReflectionCapture{pos:vec4f,props:vec4f,offset:vec4f,boxX:vec4f,boxY:vec4f,boxZ:vec4f,scales:vec4f,spare:vec4f,}
struct ReflectionCaptureBlock{header:vec4f,items:array<ReflectionCapture,${MAX_REFLECTION_CAPTURES}>,}
struct ReflectionCaptureLight{specular:vec4f,diffuse:vec4f,}`

const FUNCTIONS = `
const CAPTURE_NORMAL_ADJUST:f32=${wgslF32(CAPTURE_NORMAL_ADJUST)};
const CAPTURE_DIFFUSE_LEAST_REACH:f32=${wgslF32(CAPTURE_DIFFUSE_LEAST_REACH)};
const CAPTURE_DIFFUSE_MIPS_FROM_LAST:f32=${wgslF32(CAPTURE_DIFFUSE_MIPS_FROM_LAST)};
/** The distance from the box of half extents extent (about the origin) to p: Euclidean, zero inside. */
fn boxDistance(extent:vec3f,p:vec3f)->f32{return length(max(abs(p)-extent,vec3f(0.0)));}
fn captureLocal(c:ReflectionCapture,v:vec3f)->vec3f{return mat3x3f(c.boxX.xyz,c.boxY.xyz,c.boxZ.xyz)*v;}
/** A direction held off zero on each axis, so that its inverse is finite whatever the shader's division by zero gives: an axis-aligned ray stays parallel to the planes it never meets. */
fn captureAxisSafe(d:vec3f)->vec3f{return select(d,vec3f(1.0e-20),abs(d)<vec3f(1.0e-20));}
/** The point of the ray from P along d where it leaves the box of the capture (its local frame holds the box at plus and minus one), relative to the capture's own point. */
fn boxLeave(c:ReflectionCapture,P:vec3f,d:vec3f)->vec3f{
 let start=captureLocal(c,P-c.pos.xyz);
 let inv=1.0/captureAxisSafe(captureLocal(c,d));
 let far=max(inv*(vec3f(-1.0)-start),inv*(vec3f(1.0)-start));
 return P+min(far.x,min(far.y,far.z))*d-(c.pos.xyz+c.offset.xyz);
}
struct CaptureLookup{vector:vec3f,alpha:f32,}
fn boxCaptureVector(c:ReflectionCapture,P:vec3f,R:vec3f,adjust:f32)->CaptureLookup{
 let start=captureLocal(c,P-c.pos.xyz);
 let shrunk=c.scales.xyz-vec3f(0.5*(c.scales.w+adjust));
 let away=boxDistance(shrunk,start*c.scales.xyz);
 return CaptureLookup(boxLeave(c,P,R),1.0-smoothstep(0.0,max(0.7*c.scales.w,0.0001),away));
}
/** The diffuse lookup: the intersection held at ten metres at least, which biases the vector toward the normal near the box's faces. */
fn boxCaptureDiffuseVector(c:ReflectionCapture,P:vec3f,N:vec3f)->vec3f{
 let start=captureLocal(c,P-c.pos.xyz);
 let inv=1.0/captureAxisSafe(captureLocal(c,N));
 let far=max(inv*(vec3f(-1.0)-start),inv*(vec3f(1.0)-start));
 let reach=max(min(far.x,min(far.y,far.z)),CAPTURE_DIFFUSE_LEAST_REACH);
 return P+reach*N-(c.pos.xyz+c.offset.xyz);
}
/** The sphere lookup: the ray's far intersection with the sphere, relative to the capture's own point; the ray itself where it misses. */
fn sphereCaptureVector(c:ReflectionCapture,P:vec3f,R:vec3f,normalized:f32)->CaptureLookup{
 let local=P-c.pos.xyz;
 let b=dot(R,local);
 let determinant=b*b-(dot(local,local)-c.pos.w*c.pos.w);
 if(determinant<0.0){return CaptureLookup(R,0.0);}
 let x=saturate(2.5*normalized-1.5);
 return CaptureLookup(local+(sqrt(determinant)-b)*R-c.offset.xyz,1.0-x*x*(3.0-2.0*x));
}
/** The captures' light at P, normal N, reflection R and roughness: the specular light when wantSpecular, the diffuse light when wantDiffuse and the block holds it.
 *  A call that asks for one reads no texel for the other; R is the ray the share of each capture is taken along (the normal, for the diffuse light alone). */
fn reflectionCapturesAt(P:vec3f,N:vec3f,R:vec3f,roughness:f32,wantSpecular:bool,wantDiffuse:bool)->ReflectionCaptureLight{
 var out=ReflectionCaptureLight(vec4f(0.0,0.0,0.0,1.0),vec4f(0.0,0.0,0.0,1.0));
 let normalAdjusted=captures.header.z>0.0;
 let diffuse=wantDiffuse&&normalAdjusted;
 let mip=roughnessMip(roughness,captures.header.y);
 for(var i=0u;i<u32(captures.header.x);i++){
  if(select(out.specular.a,out.diffuse.a,diffuse&&!wantSpecular)<0.001){break;}
  let c=captures.items[i];
  let toPoint=P-c.pos.xyz;
  let reach=sqrt(dot(toPoint,toPoint));
  var adjust=0.0;
  if(normalAdjusted){adjust=dot(toPoint,N)/max(reach,0.00001)*CAPTURE_NORMAL_ADJUST;}
  let normalized=saturate((reach+adjust)/c.pos.w);
  if(reach>=c.pos.w){continue;}
  var look=CaptureLookup(R,0.0);
  var lookN=N;
  if(c.props.z>0.0){
   look=boxCaptureVector(c,P,R,adjust);
   if(diffuse){lookN=boxCaptureDiffuseVector(c,P,N);}
  }else{
   look=sphereCaptureVector(c,P,R,normalized);
   if(diffuse){lookN=sphereCaptureVector(c,P,N,normalized).vector;}
  }
  let layer=i32(c.props.y);
  let alpha=look.alpha*c.props.w;
  let weight=alpha*c.props.x;
  if(wantSpecular){
   let tapped=textureSampleLevel(captureCube,captureSampler,sceneToCube(look.vector),layer,mip);
   out.specular=vec4f(out.specular.rgb+tapped.rgb*weight*out.specular.a,out.specular.a*(1.0-tapped.a*alpha));
  }
  if(diffuse){
   let near=textureSampleLevel(captureCube,captureSampler,sceneToCube(lookN),layer,captures.header.y-CAPTURE_DIFFUSE_MIPS_FROM_LAST).rgb;
   out.diffuse=vec4f(out.diffuse.rgb+near*(weight*out.diffuse.a),out.diffuse.a*(1.0-alpha));
  }
 }
 if(diffuse&&out.diffuse.a<0.001){out.diffuse.a=0.0;}
 return out;
}
`

/** The read over the bindings `b`. */
export const reflectionCapturesWgsl = (b: ReflectionCaptureBindings): WgslDecl =>
  wgslBlock(
    `REFLECTION_CAPTURES_WGSL(${b.group}, ${b.cube}, ${b.sampler}, ${b.block})`,
    [SKY_CUBE_WGSL],
    `${STRUCTS}
@group(${b.group}) @binding(${b.cube}) var captureCube:texture_cube_array<f32>;
@group(${b.group}) @binding(${b.sampler}) var captureSampler:sampler;
@group(${b.group}) @binding(${b.block}) var<uniform> captures:ReflectionCaptureBlock;
${FUNCTIONS}`,
  )

/** The layout entries of a program that reads the captures as `b` binds them, seen by `visibility`. */
export const reflectionCaptureLayoutEntries = (
  b: ReflectionCaptureBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(b.cube, 'float', 'cube-array', visibility),
  computeSamplerEntry(b.sampler, 'filtering', visibility),
  computeBufferEntry(b.block, 'uniform', visibility),
]

/** What a program is given to read the captures with. */
export interface ReflectionCaptureReadSet {
  readonly cube: GPUTextureView
  readonly sampler: GPUSampler
  readonly block: GPUBuffer
}

/** The group entries of `set` for the read of `b`. */
export const reflectionCaptureBindEntries = (
  b: ReflectionCaptureBindings,
  set: ReflectionCaptureReadSet,
): GPUBindGroupEntry[] => [
  { binding: b.cube, resource: set.cube },
  { binding: b.sampler, resource: set.sampler },
  { binding: b.block, resource: { buffer: set.block } },
]
