// The statements the one light term (`lightLoopWgsl.ts`, `declaredLightWgsl`) is written with.

/** The light term's first statement: its exact zero where light \`rank\` cannot reach \`P\`
 *  (\`lightReaches\`, on its kind and sphere), and only then its whole record — every program, one
 *  test. */
export const REACH = (zeroTerm: string) => `
 if(!lightReaches(rank,P)){return ${zeroTerm};}
 let light=directLights.items[rank];`

/** The lamp of the light seen from \`P\` at normal \`N\`, its inverse square taken at a squared
 *  distance \`bias\` longer (\`lampSeen\`), and the term's exact zero where its falloff is (a spot's
 *  fade at its edge, the range's window). */
export const LAMP_SEEN = (zeroTerm: string, bias: string) => `
 let lamp=lampSeen(light,P,N,${bias});
 if(lamp.falloff<=0.0){return ${zeroTerm};}`

/**
 * A light's irradiance, one rule for every kind: what it adds at the point — a punctual light's
 * cosine, a rectangle's form factor (\`rectIrradiance\`), its exact zero out of range —, times the
 * light function (\`lightFunctionOf\`). The term leaves the shadow out: the program that holds it
 * traces its own.
 */
export const irradianceTerm = (rectless = false) => `
 var lit=vec3f(0.0);${
   rectless
     ? PUNCTUAL_IRRADIANCE
     : `
 if(isRect(light)){
  lit=light.colorIntensity.rgb*light.colorIntensity.w*rectIrradiance(light,P,N).w*sharesOf(light).x;
 }else{${PUNCTUAL_IRRADIANCE}
 }`
 }
 if(all(lit==vec3f(0.0))){return lit;}
 return lit*lightFunctionOf(light.params.x,P);`

/** A lamp's irradiance: its falloff and cosine (\`lampSeen\`), the inverse square
 *  taken at the distance itself, with no centimetre added, as a cache of lit surfaces is (nothing at
 *  the lamp's own centre, \`safeRcp\`), times its share of diffuse light. */
const PUNCTUAL_IRRADIANCE = `${LAMP_SEEN('vec3f(0.0)', '0.0')}
 let cosine=select(lamp.side,lamp.cosine,lamp.capsule);
 if(cosine<=0.0){return vec3f(0.0);}
 lit=light.colorIntensity.rgb*airTintOf(rank,light,P)*cloudShadowOnSurface(rank,P)*light.colorIntensity.w*lamp.falloff*cosine*sharesOf(light).x;`
