// The statements the one light term (`lightLoopWgsl.ts`, `declaredLightWgsl`) is written with.
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'

/** The light term's first statement: its exact zero where light \`rank\` cannot reach \`P\`
 *  (\`lightReaches\`, on its kind and sphere), and only then its whole record — every program, one
 *  test. */
export const REACH = (zeroTerm: string) => `
 if(!lightReaches(rank,P)){return ${zeroTerm};}
 let light=directLights.items[rank];`

/** The light's incidence at \`P\`, its unit direction and attenuation, and its exact zero where the
 *  attenuation is (a spot's fade at its edge). */
export const INCIDENCE = (zeroTerm: string) => `
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return ${zeroTerm};}`

/**
 * A light's irradiance through the proxy, one rule for every kind: what it adds at the point — a
 * punctual light's cosine, a rectangle's form factor (\`rectIrradiance\`), its exact zero out of
 * range —, then, where it adds light and casts a shadow, one ray toward it through the resident
 * proxy, started off the point along the light (\`BOUNCE_SETTINGS.shadowBiasMetres\`, up to \`shadowBiasSlopeMetres\`
 * more where the surface grazes it), which keeps a closed door closed for the bounce as for the direct term.
 * The light function multiplies what the light adds (\`lightFunctionOf\`), before the shadow's ray, which a light
 * the function wholly dims does not cast. Every shadow-casting light that adds light at the point is tested: one left untested would shine through the
 * wall. A sun's ray reaches \`reach\`; a lamp's, or a rectangle's, stops \`shadowBiasMetres\` short of the light,
 * where a surface it stands against would else shade the point, and starts at most half the way to it. A
 * rectangle casts no shadow by its contract (\`validateRect\`, \`packages/sdk-core/src/scene/light/validate.ts\`),
 * in the direct term as here: its flag is never set, and the rule tests it as any light's.
 */
export const irradianceTerm = (rectless = false) => `
 var lit=vec3f(0.0);
 var toward=vec3f(0.0);${
   rectless
     ? PUNCTUAL_IRRADIANCE
     : `
 if(isRect(light)){
  lit=light.colorIntensity.rgb*light.colorIntensity.w*rectIrradiance(light,P,N).w;
  toward=normalize(light.positionRange.xyz-P);
 }else{${PUNCTUAL_IRRADIANCE}
 }`
 }
 if(all(lit==vec3f(0.0))){return lit;}
 lit*=lightFunctionOf(light.params.x,P);
 if(all(lit==vec3f(0.0))){return lit;}
 if(castsShadow(light)){
  let fromSun=isSun(light);
  let biasNear=${wgslF32(BOUNCE_SETTINGS.shadowBiasMetres)};
  let bias=biasNear+${wgslF32(BOUNCE_SETTINGS.shadowBiasSlopeMetres)}*saturate(1.0-dot(N,toward));
  let shadowAt=P+toward*select(min(bias,0.5*length(light.positionRange.xyz-P)),bias,fromSun);
  let span=select(max(length(light.positionRange.xyz-shadowAt)-biasNear,0.0),reach,fromSun);
  if(rtBlocked(shadowAt,toward,span)){return vec3f(0.0);}
 }
 return lit;`

/** A lamp's irradiance before its shadow: its incidence, then its falloff and cosine, a lamp of
 *  size's own (\`lampSeen\`), the inverse square taken at the distance itself, with no centimetre
 *  added, as a cache of lit surfaces is (nothing at the lamp's own centre, \`inverseOf\`); its
 *  shadow's ray goes toward its centre. */
const PUNCTUAL_IRRADIANCE = `${INCIDENCE('vec3f(0.0)')}
 let lamp=lampSeen(light,P,N,incidence,0.0);
 let cosine=select(lamp.side,lamp.cosine,lamp.capsule);
 if(cosine<=0.0){return vec3f(0.0);}
 lit=light.colorIntensity.rgb*airTintOf(rank,light,P)*cloudShadowOnSurface(rank,P)*light.colorIntensity.w*lamp.falloff*cosine;
 toward=incidence.xyz;`
