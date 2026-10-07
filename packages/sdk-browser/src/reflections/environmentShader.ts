import { filteredRadianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { REFLECTION_BANDS_WGSL } from './bandsShader.ts'

/** Where a program reads its environment's nine radiance coefficients. */
export interface EnvironmentSource {
  /** Statements run first, in the shader's own syntax (e.g. carrying `R` to the world). */
  prelude: string
  /** The world direction the coefficients are expressed in. */
  direction: string
  /** Coefficient `k`, a three-component vector. */
  coefficient: (k: number) => string
}

/** The environment's order-2 radiance seen along R through the GGX lobe: the specular reflection
 *  every program falls back to where no screen hit and no probe answers, never black (#1341). An
 *  all-zero environment exits before the band moments. The diffuse term reads the same
 *  coefficients through the cosine lobe. */
export function environmentReflectionShader({
  prelude,
  direction,
  coefficient,
}: EnvironmentSource) {
  const magnitude = Array.from({ length: 9 }, (_, k) => `abs(${coefficient(k)})`).join('+')
  return `${REFLECTION_BANDS_WGSL}

fn environmentReflection(R:vec3f,rough:f32)->vec3f{
 ${prelude}
 if(dot(${magnitude},vec3f(1.0))==0.0){return vec3f(0.0);}
 let bands:vec3f=reflectionProbeBands(rough);
 return max(vec3f(0.0),${filteredRadianceShader(coefficient, direction, 'bands')});
}`
}
