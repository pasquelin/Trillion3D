import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { uniformDiskConcentric } from '../../../../math/src/wgsl/sampling.ts'

/**
 * THE PATH TRACER'S SAMPLING HELPERS, shared by its lights and its materials.
 *
 * - `ptMisPower(pdf, other)` is the power heuristic of two sampling strategies, `pdf² / (pdf² + other²)`, written with the ratio of the smaller
 *   to the larger so that it neither overflows nor divides zero by zero, and so that exchanging the arguments gives weights that add to exactly 1;
 *   `ptMisBalance` is the same with the first power.
 * - `ptFilterJitter(e, width)` is a point of the pixel,
 *   in pixels from its corner, drawn from the Gaussian anti-aliasing filter of the camera's rays (a width that covers plus or minus three standard deviations, centred on the pixel's middle,
 *   importance sampled so that every sample weighs the same: the radius's Gaussian, `sqrt(-2 ln(1 - r²))`).
 * - `ptSampleCosine(e, n)` a direction of the cosine lobe about `n` with
 *   its density (the sphere's point pushed onto the hemisphere, which has no frame to build).
 * - `ptRayBias(origin, hitT, geoNormal)` moves a ray's origin off the surface it left along the geometric normal by 16 units in the last place of the
 *   largest of its coordinates and the distance the surface was found at, and at least 2^-8 centimetres, so that it does not find the surface again.
 * - `ptRescale(v, low, high)` makes a number of the interval [low, high) one of [0, 1) again, to be used for the next choice.
 * - `ptAddLobe(lobes, lobeWeight, lobePdf, lobeProb)` adds a lobe of a model made of several to the running weight and density of the sample (`PtLobes`): the
 *   weight is the mean of the lobes' weights by their densities (`ptMisBalance`), the density their sum, each lobe taken as chosen with
 *   probability `lobeProb` (a lobe that cannot be chosen adds nothing).
 */
export const PT_MONTE_CARLO_WGSL = wgslBlock(
  'PT_MONTE_CARLO_WGSL',
  [PI, uniformDiskConcentric],
  `fn ptMisBalance(pdf:f32,other:f32)->f32{
 let x=min(pdf,other)/max(pdf,other);
 let y=select(x,1.0,pdf==other);
 let m=1.0/(1.0+y);
 return select(1.0-m,m,pdf>other);
}
fn ptMisPower(pdf:f32,other:f32)->f32{
 let x=min(pdf,other)/max(pdf,other);
 let y=select(x,1.0,pdf==other);
 let m=1.0/(1.0+y*y);
 return select(1.0-m,m,pdf>other);
}
fn ptFilterJitter(e:vec2f,width:f32)->vec2f{
 let disk=uniformDiskConcentric(e);
 let radius2=dot(disk,disk);
 let sigma=width/6.0;
 return vec2f(0.5)+sigma*disk*sqrt(-2.0*log(max(1.0-radius2,1.0e-30))/max(radius2,1.0e-30));
}
fn ptSampleCosine(e:vec2f,n:vec3f)->vec4f{
 let phi=2.0*PI*e.x;
 let cosTheta=1.0-2.0*e.y;
 let sinTheta=sqrt(max(1.0-cosTheta*cosTheta,0.0));
 let v=normalize(vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta)+n);
 return vec4f(v,saturate(dot(v,n))/PI);
}
fn ptRayBias(origin:vec3f,hitT:f32,geoNormal:vec3f)->vec3f{
 let reference=max(max(abs(origin.x),abs(origin.y)),max(abs(origin.z),hitT));
 let relative=bitcast<f32>(bitcast<u32>(reference)+16u)-reference;
 return origin+max(3.90625e-5,relative)*geoNormal;
}
fn ptRescale(v:f32,low:f32,high:f32)->f32{return min((v-low)/(high-low),0.99999994);}
struct PtLobes{weight:vec3f,pdf:f32,}
fn ptAddLobe(lobes:PtLobes,lobeWeight:vec3f,lobePdf:f32,lobeProb:f32)->PtLobes{
 if(lobeProb>1.1754943508e-38){
  let p=lobePdf*lobeProb;
  let w=lobeWeight/lobeProb;
  return PtLobes(mix(lobes.weight,w,ptMisBalance(p,lobes.pdf)),lobes.pdf+p);
 }
 return lobes;
}`,
)
