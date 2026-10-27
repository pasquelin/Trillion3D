import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { horizonWrap } from '../../../../math/src/wgsl/lighting.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { lightTraits } from './lightReachWgsl.ts'

/**
 * A LAMP AS A SURFACE SEES IT: a point, or a source with a size — a sphere of `shape.x` metres, a
 * tube twice as long as `tubeHalfLengthOf`, along its axis `emitterAxisOf` (its two ends are the light's place less and
 * plus `tubeHalfAxisOf`), a capsule with both — and what the term of a light reads of it (`lampSeen`): the inverse
 * square, the cosine, the direction toward it. A lamp with no size is the point: its inverse square
 * is `1 / (d² + bias)` and its cosine the plain one. The one place the sum is formed is here: the
 * range and cone mask comes from `lampReach` (`lightWgsl.ts`), the distance's weight from this block.
 *
 * - A tube's falloff is the integral of the inverse square along it: with `i = 1 / (|p₀| |p₁|)` over
 *   the distances to its two ends and `c` the cosine between the directions to them, `i / (c/2 + 1/2 +
 *   bias · i)`. Its mean direction is `(u₀ + u₁) / 2` over the unit directions to the ends, and the
 *   surface's cosine is the normal's dot with that vector, whose length is the line's form factor.
 * - A sphere, or a capsule, wraps the horizon: where the sphere's angular radius `α` (sin² α =
 *   radius² times the falloff) reaches the surface's horizon, the cosine falls off by the Hermite
 *   curve `(sin α + cos)² / (4 sin α)`, down to nothing at `−sin α`, not at the horizon. A sun's disk
 *   wraps it by its own sine (`sourceTermOf`), the curve of the half-angle the disk really has, and not by a narrower one whose
 *   squared sine is half the sine's. Against the exact irradiance of a uniform disk, by quadrature, over cosines from −1.2 to 1.2
 *   sines, the root-mean-square error of the full sine equals the narrower curve's at a half-angle of 0.5 degrees, is 0.00191
 *   against 0.00195 at 5 degrees and 0.00511 against 0.00635 at 15 degrees: the full sine is the closer, so it is kept. The sun's
 *   specular lobe takes the full sine too (`lampLook`).
 * - A lamp that does not fall off as the inverse square (`shape.y` an exponent) has a falloff of 1:
 *   its light is the mask alone, while the horizon's wrap still takes the inverse square's.
 *
 * Where a sum is nothing the reciprocal is nothing (`safeRcp`), not an infinity: with the bias 0 of
 * the bounce cache's light, the sum is the squared distance itself, nothing at the lamp's own
 * centre or on a tube's line between its ends, and the division would give an infinity there and,
 * times the direction it has none of, a NaN into the cache: that point takes no light from the lamp.
 */
export const LAMP_WGSL = wgslBlock(
  'LAMP_WGSL',
  [safeRcp, horizonWrap, lightTraits],
  `
/** Whether a lamp has a size: a source radius or a tube. A sun's lane of \`shape\` is its disk (\`lampLook\`), and a
 *  rectangle's its axis: neither a lamp's source. */
fn isCapsule(light:DirectLight)->bool{return !isSun(light)&&!isRect(light)&&(light.shape.x>0.0||tubeHalfLengthOf(light)>0.0||light.capsule.w>0.0);}
/** A lamp seen from a point of normal N: the unit direction \`toward\` it (the mean of its ends, for a
 *  tube) and \`centre\` its centre's (the same for a lamp with no tube), its \`falloff\` times the
 *  mask, the signed cosine \`side\` of the plain direction and the \`cosine\` the surface takes light by
 *  (wrapped about the horizon, a tube's vector irradiance, at least 0), \`wrap\` its sphere's sin² α,
 *  \`lineCos\` the cosine between the directions to a tube's ends (1 for none), and whether the lamp
 *  has a size. */
struct Lamp{toward:vec3f,centre:vec3f,falloff:f32,side:f32,cosine:f32,wrap:f32,lineCos:f32,capsule:bool,}
/** The inverse square of a lamp with no tube, \`offset\` away from the point, at a squared distance
 *  \`bias\` longer: the one place the sum \`1 / (d² + bias)\` is formed. */
fn pointFalloff(offset:vec3f,bias:f32)->f32{return safeRcp(dot(offset,offset)+bias);}
/** A lamp of size seen from the point \`offset\` away from its centre, a tube \`halfAxis\` long on each
 *  side of it (zero for a sphere), of source \`radius\`, at normal N, its range and cone \`mask\`, its
 *  inverse square taken at a squared distance \`bias\` longer: the sum \`1 / (d² + bias)\`, a tube's
 *  \`i / (c/2 + 1/2 + bias · i)\`. \`bias\` is \`LAMP_BIAS\`, a medium's own in the way of its cells, or 0
 *  for the light a surface's cache stores. \`squared\` false, the light is the mask alone. */
fn capsuleLamp(offset:vec3f,halfAxis:vec3f,radius:f32,N:vec3f,mask:f32,bias:f32,squared:bool)->Lamp{
 var falloff:f32;var lineCos=1.0;var mean:vec3f;
 if(any(halfAxis!=vec3f(0.0))){
  let p0=offset-halfAxis;let p1=offset+halfAxis;
  let i0=safeRcp(length(p0));let i1=safeRcp(length(p1));
  let i01=i0*i1;
  lineCos=clamp(dot(p0,p1)*i01,-1.0,1.0);
  falloff=i01*safeRcp(lineCos*0.5+0.5+bias*i01);
  mean=0.5*(p0*i0+p1*i1);
 }else{
  falloff=pointFalloff(offset,bias);
  mean=offset*safeRcp(length(offset));
 }
 let toward=mean*safeRcp(length(mean));
 var cosine=dot(N,mean);
 let wrap=saturate(radius*radius*falloff);
 if(radius>0.0){cosine=horizonWrap(cosine,sqrt(wrap));}
 return Lamp(toward,toward,mask*select(1.0,falloff,squared),dot(N,toward),saturate(cosine),wrap,lineCos,true);
}
/** The lamp of \`light\` seen from \`P\` at normal N, its inverse square taken at a squared distance
 *  \`bias\` longer (\`capsuleLamp\`). A sun gives the same light at every point, never weighed by
 *  distance, and has a size where its disk has (\`capsule\`: its highlight is the disk's, \`lampLook\`); a lamp of no size is its
 *  mask over the distance, the plain cosine apart. */
fn lampSeen(light:DirectLight,P:vec3f,N:vec3f,bias:f32)->Lamp{
 if(isSun(light)){
  let L=-light.directionCone.xyz;
  let side=dot(N,L);
  let sine=sourceTermOf(light);
  return Lamp(L,L,1.0,side,saturate(horizonWrap(side,sine)),sine*sine,1.0,light.shape.x>0.0);
 }
 let reach=lampReach(light,P);
 let offset=light.positionRange.xyz-P;
 let squared=light.shape.y<=0.0;
 if(!isCapsule(light)){
  let side=dot(N,reach.xyz);
  return Lamp(reach.xyz,reach.xyz,reach.w*select(1.0,pointFalloff(offset,bias),squared),side,max(side,0.0),0.0,1.0,false);
 }
 var lamp=capsuleLamp(offset,tubeHalfAxisOf(light),light.shape.x,N,reach.w,bias,squared);
 lamp.centre=reach.xyz;
 return lamp;
}`,
)

/**
 * A LOCAL LIGHT AS A POINT OF A MEDIUM SEES IT, which has no surface: the unit direction toward it
 * in `xyz` and, in `w`, how much of it reaches the point. A rectangle is its form factor with no
 * normal times its range window (`rectWindowed`); any other lamp the falloff its own term gives
 * (`lampSeen`), its cosine unread, its inverse square taken at a squared distance `bias` longer
 * (`LAMP_BIAS` for a point of no cell size). The volumetric fog and the clouds both read a lamp so.
 */
export const VOLUME_LAMP_WGSL = wgslBlock(
  'VOLUME_LAMP_WGSL',
  [LAMP_WGSL],
  `
fn volumeLamp(light:DirectLight,P:vec3f,bias:f32)->vec4f{
 if(isRect(light)){
  let r=rectView(light,P);
  return vec4f(normalize(light.positionRange.xyz-P),rectWindowed(r));
 }
 let lamp=lampSeen(light,P,vec3f(0.0),bias);
 return vec4f(lamp.centre,lamp.falloff);
}`,
)
