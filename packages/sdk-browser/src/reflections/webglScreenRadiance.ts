import type { ScreenRadiance } from './screenRadianceShader.ts'

/** The WebGL2 resolve: the environment probe is its fallback (`probe.ts`); the frozen source
 *  holds no reflection, and a resolved mirror reads the reduced image. */
export const WEBGL_SCREEN_RADIANCE: ScreenRadiance = {
  name: 'reflectedRadiance',
  disabled: '!reflectionEnabled',
  fallback: (rough) => `environmentReflection(R,${rough})`,
  head:
    'if(reflectionCapture){return vec3f(0.0);}' +
    'if(reflectionResolve&&mirrorWeight(rough)>0.0){' +
    'return texture(reflectionColor,gl_FragCoord.xy/vec2f(textureSize(reflectionColor,0))).rgb;}',
}
