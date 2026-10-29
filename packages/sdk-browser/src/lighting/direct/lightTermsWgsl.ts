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
 * A light's irradiance, one rule for every kind: what it adds at the point, times the clouds' shade (a punctual light's), the light function
 * and the light profile, and not its shadow. \`given\` false leaves the shade, the function and the profile out, for a program that keeps them,
 * with the shadow, in a mask of its own; \`profiled\` false leaves the profile out of the \`given\` term (the key's \`profileless\`).
 */
export const irradianceTerm = (rectless = false, given = true, profiled = true) => `
 var lit=vec3f(0.0);${
   rectless
     ? punctualIrradiance(given)
     : `
 if(isRect(light)){
  let r=rectView(light,P);
  let incident=rectIrradianceOf(r,N);
  lit=light.colorIntensity.rgb*lightStrength(light)*incident.w*sharesOf(light).x;
  if(incident.w>0.0){lit*=rectColour(r,incident.xyz);}
 }else{${punctualIrradiance(given)}
 }`
 }
 if(all(lit==vec3f(0.0))){return lit;}
 return ${given ? `lit*lightFunctionOf(light,P)${profiled ? '*lightProfileOf(light,P)' : ''}` : 'lit'};`

/** A lamp's irradiance: its falloff and cosine (\`lampSeen\`), the inverse square
 *  taken at the distance itself, with no centimetre added, as a cache of lit surfaces is (nothing at
 *  the lamp's own centre, \`safeRcp\`), times its share of diffuse light, and the air's tint toward it
 *  at the ground (\`airGroundTintOf\`), one for the whole cache. */
const punctualIrradiance = (given: boolean) => `${LAMP_SEEN('vec3f(0.0)', '0.0')}
 let cosine=select(lamp.side,lamp.cosine,lamp.capsule);
 if(cosine<=0.0){return vec3f(0.0);}
 lit=light.colorIntensity.rgb*airGroundTintOf(rank)*${given ? 'cloudShadowOnSurface(rank,P)*' : ''}lightStrength(light)*lamp.falloff*cosine*sharesOf(light).x;`
