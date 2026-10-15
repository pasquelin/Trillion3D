// The statements the one light term (`lightLoopWgsl.ts`, `declaredLightWgsl`) is written with.

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
 * proxy, which keeps a closed door closed for the bounce as for the direct term. Every
 * shadow-casting light that adds light at the point is tested: one left untested would shine
 * through the wall. A sun's ray reaches \`reach\`, a lamp's the lamp, a rectangle's its centre. A
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
 if(light.params.z>0.5){
  let span=select(length(light.positionRange.xyz-P),reach,isSun(light));
  if(rtBlocked(P+N*1e-3,toward,span)){return vec3f(0.0);}
 }
 return lit;`

/** A punctual light's irradiance before its shadow: its incidence, then its cosine. */
const PUNCTUAL_IRRADIANCE = `${INCIDENCE('vec3f(0.0)')}
 let cosine=dot(N,incidence.xyz);
 if(cosine<=0.0){return vec3f(0.0);}
 lit=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
 toward=incidence.xyz;`
