import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * A LAMP AS A SURFACE SEES IT: a point, or a source with a size — a sphere of `shape.x` metres, a
 * tube twice as long as `capsule.xyz` is, along it (its two ends are the light's place less and
 * plus it), a capsule with both — and what the term of a light reads of it (`lampSeen`): the inverse
 * square, the cosine, the direction toward it. A lamp with no size is the point: its inverse square
 * is `1 / (d² + LAMP_BIAS)` and its cosine the plain one, as the incidence has them.
 *
 * - A tube's falloff is the integral of the inverse square along it: with `i = 1 / (|p₀| |p₁|)` over
 *   the distances to its two ends and `c` the cosine between the directions to them, `i / (c/2 + 1/2 +
 *   bias · i)`. Its mean direction is `(u₀ + u₁) / 2` over the unit directions to the ends, and the
 *   surface's cosine is the normal's dot with that vector, whose length is the line's form factor.
 * - A sphere, or a capsule, wraps the horizon: where the sphere's angular radius `α` (sin² α =
 *   radius² times the falloff) reaches the surface's horizon, the cosine falls off by the Hermite
 *   curve `(sin α + cos)² / (4 sin α)`, down to nothing at `−sin α`, not at the horizon.
 *
 * What is finite stays finite: a point on a tube's end or between its ends, or a reflection ray
 * along its line (`lineClosest`), answer numbers.
 */
export const LAMP_WGSL = wgslBlock(
  'LAMP_WGSL',
  [],
  `
const LINE_FLOOR:f32=1e-12;
/** \`1 / sum\`, nothing where the sum is nothing. */
fn inverseOf(sum:f32)->f32{return select(0.0,1.0/sum,sum>0.0);}
/** Whether a lamp has a size: a source radius or a tube. A sun's lane of \`shape\` is its disk, and a
 *  rectangle's its axis: neither a lamp's source. */
fn isCapsule(light:DirectLight)->bool{return !isSun(light)&&(light.shape.x>0.0||any(light.capsule!=vec4f(0.0)));}
/** A lamp seen from a point of normal N: the unit direction \`toward\` it (the mean of its ends, for a
 *  tube), its \`falloff\` times the incidence's mask, the signed cosine \`side\` of the plain direction
 *  and the \`cosine\` the surface takes light by (wrapped about the horizon, a tube's vector
 *  irradiance, at least 0), \`wrap\` its sphere's sin² α, \`lineCos\` the cosine between the directions
 *  to a tube's ends (1 for none), and whether the lamp has a size. */
struct Lamp{toward:vec3f,falloff:f32,side:f32,cosine:f32,wrap:f32,lineCos:f32,capsule:bool,}
/** A cosine wrapped about the horizon of a sphere of sin² α \`sinSq\`: the Hermite curve from 0 at −sin α
 *  to sin α at sin α, whose slope there is 1, joining the plain cosine. */
fn horizonWrap(cosine:f32,sinSq:f32)->f32{
 let s=sqrt(sinSq);
 if(cosine<s&&s>0.0){
  let c=max(cosine,-s);
  return (s+c)*(s+c)/(4.0*s);
 }
 return cosine;
}
/** A lamp of size seen from the point \`offset\` away from its centre, a tube \`halfAxis\` long on each
 *  side of it (zero for a sphere), of source \`radius\`, at normal N, its range and cone \`mask\`, its
 *  inverse square taken at a squared distance \`bias\` longer: the sum \`1 / (d² + bias)\`, a tube's
 *  \`i / (c/2 + 1/2 + bias · i)\`. \`bias\` is \`LAMP_BIAS\`, a medium's own in the way of its cells, or 0
 *  for the light a surface's cache stores: there the sum is the squared distance itself, which is
 *  nothing at the lamp's own centre (or on a tube's line between its ends), where the division
 *  would give an infinity and, with the direction it has none of, a NaN into the cache: that point
 *  takes no light from it (\`inverseOf\`). */
fn capsuleLamp(offset:vec3f,halfAxis:vec3f,radius:f32,N:vec3f,mask:f32,bias:f32)->Lamp{
 var falloff:f32;var lineCos=1.0;var mean:vec3f;
 if(any(halfAxis!=vec3f(0.0))){
  let p0=offset-halfAxis;let p1=offset+halfAxis;
  let i0=inverseSqrt(max(dot(p0,p0),LINE_FLOOR));let i1=inverseSqrt(max(dot(p1,p1),LINE_FLOOR));
  let i01=i0*i1;
  lineCos=clamp(dot(p0,p1)*i01,-1.0,1.0);
  falloff=i01*inverseOf(lineCos*0.5+0.5+bias*i01);
  mean=0.5*(p0*i0+p1*i1);
 }else{
  let d2=dot(offset,offset);
  falloff=inverseOf(d2+bias);
  mean=offset/max(sqrt(d2),1e-6);
 }
 let toward=mean*inverseSqrt(max(dot(mean,mean),1e-20));
 var cosine=dot(N,mean);
 let wrap=saturate(radius*radius*falloff);
 if(radius>0.0){cosine=horizonWrap(cosine,wrap);}
 return Lamp(toward,mask*falloff,dot(N,toward),saturate(cosine),wrap,lineCos,true);
}
/** The lamp of \`light\` seen from \`P\` at normal N, its \`incidence\` (\`directIncidence\`) given, its
 *  inverse square taken at a squared distance \`bias\` longer (\`capsuleLamp\`): a lamp of no size is the
 *  incidence itself, the plain cosine apart, where \`bias\` is \`LAMP_BIAS\`, as the incidence has it. */
fn lampSeen(light:DirectLight,P:vec3f,N:vec3f,incidence:vec4f,bias:f32)->Lamp{
 let sized=isCapsule(light);
 if(!sized&&(isSun(light)||bias==LAMP_BIAS)){
  let side=dot(N,incidence.xyz);
  return Lamp(incidence.xyz,incidence.w,side,max(side,0.0),0.0,1.0,false);
 }
 let offset=light.positionRange.xyz-P;
 var lamp=capsuleLamp(offset,light.capsule.xyz,light.shape.x,N,incidence.w*(dot(offset,offset)+LAMP_BIAS),bias);
 lamp.capsule=sized;
 return lamp;
}`,
)
