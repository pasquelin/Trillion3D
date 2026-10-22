import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * POSITIONS FAR FROM THE ORIGIN, as a pair of floats: a world position of the global distance field
 * is its centimetres as a high float and the low float that completes it, the sum written the way
 * a program of the field reads it. The field's passes subtract two such positions, or add the
 * translation that brings one to the clipmap, and only the small difference is taken to a float:
 * the object records and the clipmaps hold their centres in this form, as the host splits them
 * (`objectRecords.ts`, `clipmapUniforms.ts`). The additions are the error-free sums of two floats
 * (two sum) and the faster one that needs the larger first (fast two sum); a device that rewrites
 * them gives back the precision of a float, no less.
 */
export const DOUBLE_FLOAT_WGSL = wgslBlock(
  'DOUBLE_FLOAT_WGSL',
  [],
  `
struct DfVec3{hi:vec3f,lo:vec3f}
fn dfTwoSum(a:vec3f,b:vec3f)->DfVec3{
 let s=a+b;
 let v=s-a;
 let q=s-v;
 let r=a-q;
 let t=b-v;
 return DfVec3(s,r+t);
}
fn dfFastTwoSum(a:vec3f,b:vec3f)->DfVec3{
 let s=a+b;
 let t=s-a;
 return DfVec3(s,b-t);
}
fn dfNegate(v:DfVec3)->DfVec3{return DfVec3(-v.hi,-v.lo);}
fn dfAddFloat(l:DfVec3,r:vec3f)->DfVec3{
 var s=dfTwoSum(l.hi,r);
 s.lo+=l.lo;
 return dfFastTwoSum(s.hi,s.lo);
}
fn dfAddFloatDemote(l:DfVec3,r:vec3f)->vec3f{
 let s=dfTwoSum(l.hi,r);
 return s.hi+(l.lo+s.lo);
}
fn dfAddDemote(l:DfVec3,r:DfVec3)->vec3f{
 let s=dfTwoSum(l.hi,r.hi);
 return s.hi+(s.lo+(l.lo+r.lo));
}
fn dfSubtractFromFloat(l:vec3f,r:DfVec3)->DfVec3{return dfAddFloat(dfNegate(r),l);}
fn dfToTranslated(p:DfVec3,translation:DfVec3)->vec3f{
 let high=p.hi+translation.hi;
 let low=p.lo+translation.lo;
 return high+low;
}`,
)
