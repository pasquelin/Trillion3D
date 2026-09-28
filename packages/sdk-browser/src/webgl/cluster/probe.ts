import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts';
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts';
import { addLightIrradiance } from '../../../../sdk-core/src/world/light/lightRecord.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';

/**
 * THE ENVIRONMENT IRRADIANCE ON THE WEBGL2 PATH: a light probe's nine coefficients, read as
 * the WebGPU resolve reads the scene environment (`packages/sdk-core/src/scene/core/environment.ts`, `environmentLighting`)
 * — same band order, same cosine-lobe factors, a world-space normal, a clamp at zero. A probe
 * takes no light slot: every visible one adds into the same nine coefficients, scaled by its
 * intensity — its colour everywhere when it carries none, as a world adds it (`addLightIrradiance`)
 * — and the program evaluates them once per pixel.
 */
export const PROBE_IRRADIANCE_GLSL = `
uniform vec3 probeSh[${ENVIRONMENT_COEFFICIENTS}];uniform mat3 viewRotation;
vec3 probeIrradiance(vec3 viewNormal){vec3 N=viewNormal*viewRotation;
vec3 E=${irradianceShader((k) => `probeSh[${k}]`, 'N')};
return max(E,vec3(0.0));}`;

/** The summed coefficients of the frame's visible probes, and the rotation that carries a
 *  view-space normal back to the world the coefficients are expressed in. */
export class WebglClusterProbe {
  private sh = new Float32Array(ENVIRONMENT_COEFFICIENTS * 3);
  private rotation = new Float32Array(9);
  private shAt: WebGLUniformLocation | null;
  private rotationAt: WebGLUniformLocation | null;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.shAt = gl.getUniformLocation(program, 'probeSh');
    this.rotationAt = gl.getUniformLocation(program, 'viewRotation');
  }
  reset() {
    this.sh.fill(0);
  }
  add(probe: Light) {
    addLightIrradiance(probe, this.sh);
  }
  /** Writes the coefficients and the world-to-view rotation of `view`, column-major: the
   *  program multiplies a view-space normal on the left, its transpose, the view-to-world. */
  upload(view: ArrayLike<number>) {
    for (let column = 0; column < 3; column++)
      for (let row = 0; row < 3; row++) this.rotation[column * 3 + row] = view[column * 4 + row];
    this.gl.uniform3fv(this.shAt, this.sh);
    this.gl.uniformMatrix3fv(this.rotationAt, false, this.rotation);
  }
}
