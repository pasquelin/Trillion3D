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
 * clouds' shade (a punctual light's) and the light function (\`lightFunctionOf\`). The term leaves the shadow
 * out: the program that holds it traces its own. \`given\` false leaves the clouds' shade and the light function
 * out too: the term of a program that keeps them, with the shadow, in a mask of its own.
 */
export const irradianceTerm = (rectless = false, given = true) => `
 var lit=vec3f(0.0);${
   rectless
     ? punctualIrradiance(given)
     : `
 if(isRect(light)){
  lit=light.colorIntensity.rgb*light.colorIntensity.w*rectIrradiance(light,P,N).w*sharesOf(light).x;
 }else{${punctualIrradiance(given)}
 }`
 }
 if(all(lit==vec3f(0.0))){return lit;}
 return ${given ? 'lit*lightFunctionOf(light.params.x,P)' : 'lit'};`

/** A lamp's irradiance: its falloff and cosine (\`lampSeen\`), the inverse square
 *  taken at the distance itself, with no centimetre added, as a cache of lit surfaces is (nothing at
 *  the lamp's own centre, \`safeRcp\`), times its share of diffuse light. */
const punctualIrradiance = (given: boolean) => `${LAMP_SEEN('vec3f(0.0)', '0.0')}
 let cosine=select(lamp.side,lamp.cosine,lamp.capsule);
 if(cosine<=0.0){return vec3f(0.0);}
 lit=light.colorIntensity.rgb*airTintOf(rank,light,P)*${given ? 'cloudShadowOnSurface(rank,P)*' : ''}light.colorIntensity.w*lamp.falloff*cosine*sharesOf(light).x;`
