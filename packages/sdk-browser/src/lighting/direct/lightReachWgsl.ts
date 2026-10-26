import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { LIGHT_KIND_SPAN } from '../../../../sdk-core/src/scene/light/contracts.ts'

/**
 * Whether a local light may light a point at `offset` from it (its centre minus the point): the one
 * test of where a light gives energy — the first statement of the one light term
 * (`declaredLight`, `declaredIrradiance`, through `lightReaches`) and the shadow passes' test at
 * their own points. Zero past its `range` — a point at the range itself is reached, the light's energy
 * there already none (`rangeWindow`) —, at or outside a spot's cone of
 * cosine `cosEdge` around `forward` (its fade), and behind a rectangle's (`rect`) plane, `forward`
 * the direction it emits along: a point in the plane itself is in front. No divide: the range on
 * the squared distance — the sphere test, a dot and a compare —, the cone against the distance
 * scaled by its cosine, tested only for a light that has one: `cosEdge` is −2 for any other, which
 * no cosine reaches. A point no comparison orders (NaN) is reached, left to the lighting.
 */
export const localLightReaches = wgslFn(
  'localLightReaches',
  [],
  `fn localLightReaches(offset:vec3f,range:f32,cosEdge:f32,forward:vec3f,rect:bool)->bool{
 let lengthSquared=dot(offset,offset);
 if(lengthSquared>range*range){return false;}
 if(rect){return !(dot(offset,forward)>0.0);}
 if(cosEdge<-1.0){return true;}
 return !(dot(-offset,forward)<=cosEdge*sqrt(lengthSquared));
}`,
)

/** The range window at `distance` from a light's centre: one at the centre, zero at its range. */
export const rangeWindow = wgslFn(
  'rangeWindow',
  [],
  `fn rangeWindow(distance:f32,range:f32)->f32{
 let ratio=distance/range;
 return pow(clamp(1.0-ratio*ratio*ratio*ratio,0.0,1.0),2.0);
}`,
)

/** The window of a lamp that does not fall off as the inverse square, at `distance` from its centre:
 *  one at the centre, zero at its range, the square of the distance over the square of the range
 *  taken from one and raised to `exponent` (`SceneLight.radialExponent`). */
export const radialWindow = wgslFn(
  'radialWindow',
  [],
  `fn radialWindow(distance:f32,range:f32,exponent:f32)->f32{
 let ratio=distance/range;
 return pow(1.0-saturate(ratio*ratio),exponent);
}`,
)

/** A light's kind word (`LIGHT_FIELD.kind`) is a float: its rank, under `LIGHT_KIND_SPAN`, plus the flags
 *  above it (`LIGHT_FLAG`). The rank alone: */
const lightKindOf = wgslFn(
  'lightKindOf',
  [],
  `fn lightKindOf(word:f32)->f32{return f32(u32(word)%${LIGHT_KIND_SPAN}u);}`,
)

/** Whether a flag bit (`LIGHT_FLAG`) is set in a light's kind word. */
export const lightFlagged = wgslFn(
  'lightFlagged',
  [],
  'fn lightFlagged(word:f32,flag:u32)->bool{return (u32(word)&flag)!=0u;}',
)

/** The one place that rereads a kind word as a rank: every kind's test its call. */
export const isKind = wgslFn(
  'isKind',
  [lightKindOf],
  'fn isKind(word:f32,rank:f32)->bool{return abs(lightKindOf(word)-rank)<0.5;}',
)
