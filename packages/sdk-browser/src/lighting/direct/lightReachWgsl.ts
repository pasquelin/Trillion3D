import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * Whether a local light may light a point at `offset` from it (its centre minus the point): the one
 * test of where a light gives energy — the first statement of the one light term
 * (`declaredLight`, `declaredIrradiance`, through `lightReaches`) and the shadow passes' test at
 * their own points. Zero at or past its `range` (`rangeWindow`), at or outside a spot's cone of
 * cosine `cosEdge` around `forward` (its fade), and on a rectangle's (`rect`) back, `forward` the
 * direction it emits along. No divide: the range on the squared distance — the sphere test, a dot
 * and a compare —, the cone against the distance scaled by its cosine, tested only for a light that
 * has one: `cosEdge` is −2 for any other, which no cosine reaches. A point no comparison orders
 * (NaN) is reached, left to the lighting.
 */
export const localLightReaches = wgslFn(
  'localLightReaches',
  [],
  `fn localLightReaches(offset:vec3f,range:f32,cosEdge:f32,forward:vec3f,rect:bool)->bool{
 let lengthSquared=dot(offset,offset);
 if(lengthSquared>=range*range){return false;}
 if(rect){return !(dot(offset,forward)>=0.0);}
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

/** The light buffer's type rank is a float: the one place that rereads it, every kind's test its call. */
export const isKind = wgslFn(
  'isKind',
  [],
  'fn isKind(kind:f32,rank:f32)->bool{return abs(kind-rank)<0.5;}',
)
