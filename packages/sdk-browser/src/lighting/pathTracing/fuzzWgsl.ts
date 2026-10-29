import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { sheenLtcCoefficients } from '../sheenLtcWgsl.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'

/**
 * THE FUZZ OF A CLOTH, a layer of fibres over the surface's lobes, sampled and evaluated as the multiple-scattering sheen: a cosine lobe bent by the linear transform the sheen table gives for the
 * view (`sheenLtcCoefficients`, in the lights' buffer). `ptFuzzPrepare(v, roughness, amount)` fixes it for the view `v` in the shading frame: the direction across the normal the view leans to, the
 * transform's two entries, the lobe's weight (the amount times its directional albedo) and the share of the light the lobes under it keep (one less that weight). `ptFuzzEval(f, l, colour)` is the weight
 * (`xyz`, the weight times the fuzz colour) and the density (`w`) of the direction `l`, none at or under the horizon; `ptFuzzSample(f, e)` draws a direction, the cosine lobe moved by the transform.
 */
export const PT_FUZZ_WGSL = wgslBlock(
  'PT_FUZZ_WGSL',
  [PI, sheenLtcCoefficients, PT_MONTE_CARLO_WGSL],
  `struct PtFuzz{tangent:vec2f,aInv:f32,bInv:f32,scale:f32,keep:f32,}
fn ptFuzzPrepare(v:vec3f,roughness:f32,amount:f32)->PtFuzz{
 var f:PtFuzz;
 let length2=dot(v.xy,v.xy);
 f.tangent=select(vec2f(1.0,0.0),v.xy*inverseSqrt(length2),length2>0.0);
 let ltc=sheenLtcCoefficients(v.z,roughness);
 f.aInv=ltc.x;
 f.bInv=ltc.y;
 f.scale=amount*ltc.z;
 f.keep=1.0-amount*ltc.z;
 return f;
}
fn ptFuzzEval(f:PtFuzz,l:vec3f,colour:vec3f)->vec4f{
 if(l.z<=0.0){return vec4f(0.0);}
 let local=vec3f(l.x*f.tangent.x+l.y*f.tangent.y,l.y*f.tangent.x-l.x*f.tangent.y,l.z);
 let wrapped=vec3f(f.aInv*local.x+f.bInv*local.z,f.aInv*local.y,local.z);
 let scaled=f.aInv/dot(wrapped,wrapped);
 return vec4f(f.scale*colour,wrapped.z*scaled*scaled/PI);
}
fn ptFuzzSample(f:PtFuzz,e:vec2f)->vec3f{
 let c=ptSampleCosine(e,vec3f(0.0,0.0,1.0)).xyz;
 let l=normalize(vec3f(c.x-c.z*f.bInv,c.y,f.aInv*c.z));
 return vec3f(l.x*f.tangent.x-l.y*f.tangent.y,l.x*f.tangent.y+l.y*f.tangent.x,l.z);
}`,
)
