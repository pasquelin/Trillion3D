import { filteredRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts';
import { shaderLanguage } from '../math/shaderLanguage.ts';

/** GGX split-sum kernel moments for an order-2 radiance field, in either graphics API.
 * With z=N.L, its normalized density is z/(1+k+(k-1)z)^2, k=roughness^4.
 * Zonal convolution multiplies bands 0/1/2 by E[1], E[z], E[(3z²-1)/2].
 * This evaluates the represented radiance, not a new ray budget or a second environment
 * representation. */
export const reflectionBandsShader = (language: 'wgsl' | 'glsl') =>
  shaderLanguage(
    `
fn reflectionProbeBands(rough:f32)->vec3f{
 var k:f32=max(rough*rough*rough*rough,1e-8);
 var a:f32=1.0+k;var b:f32=k-1.0;var q:f32=-b/a;
 var moments:vec3f=vec3f(0.0);
 if(q<0.25){
  var power:f32=1.0;
  // The geometric tail after twelve terms is below 3e-7 at q=.25.
  for(var index:i32=0;index<12;index++){
   var i:f32=f32(index);moments+=vec3f(1.0/(i+2.0),1.0/(i+3.0),1.0/(i+4.0))*(i+1.0)*power;
   power*=q;
  }
 }else{
  var j0:f32=1.0/(a*(2.0*k));
  var h0:f32=log(2.0*k/a)/b;
  var h1:f32=(1.0-a*h0)/b;
  var h2:f32=(0.5-a*h1)/b;
  var j1:f32=(h0-a*j0)/b;
  var j2:f32=(h1-a*j1)/b;
  var j3:f32=(h2-a*j2)/b;
  moments=vec3f(j1,j2,j3);
 }
 return vec3f(1.0,moments.y/moments.x,0.5*(3.0*moments.z/moments.x-1.0));
}`,
    language,
  );

/** Where a program reads its environment's nine radiance coefficients. */
export interface EnvironmentSource {
  /** Statements run first, in the shader's own syntax (e.g. carrying `R` to the world). */
  prelude: string;
  /** The world direction the coefficients are expressed in. */
  direction: string;
  /** Coefficient `k`, a three-component vector. */
  coefficient: (k: number) => string;
}

/** The environment's order-2 radiance seen along R through the GGX lobe: the specular reflection
 *  every program falls back to where no screen hit and no probe answers, never black (#1341). An
 *  all-zero environment exits before the band moments. The diffuse term reads the same
 *  coefficients through the cosine lobe. */
export function environmentReflectionShader(
  language: 'wgsl' | 'glsl',
  { prelude, direction, coefficient }: EnvironmentSource,
) {
  const empty = Array.from({ length: 9 }, (_, k) => `${coefficient(k)}==vec3f(0.0)`);
  const allZero =
    language === 'wgsl' ? empty.map((test) => `all(${test})`).join('&&') : empty.join('&&');
  return `${reflectionBandsShader(language)}
${shaderLanguage(
  `
fn environmentReflection(R:vec3f,rough:f32)->vec3f{
 ${prelude}
 if(${allZero}){return vec3f(0.0);}
 var bands:vec3f=reflectionProbeBands(rough);
 return max(vec3f(0.0),${filteredRadianceShader(coefficient, direction, 'bands')});
}`,
  language,
)}`;
}
