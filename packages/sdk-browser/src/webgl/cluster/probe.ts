import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts';
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts';

/**
 * THE ENVIRONMENT IRRADIANCE ON THE WEBGL2 PATH: a host light probe's nine coefficients, read as
 * the WebGPU resolve reads the scene environment (`packages/sdk-core/src/scene/core/environment.ts`, `environmentLighting`)
 * — same band order, same cosine-lobe factors, a world-space normal, a clamp at zero. A probe
 * takes no light slot: every visible one adds into the same nine coefficients, scaled by its
 * intensity, and the program evaluates them once per pixel.
 */
export const PROBE_IRRADIANCE_GLSL = `
uniform vec3 probeSh[${ENVIRONMENT_COEFFICIENTS}];uniform mat3 viewRotation;
vec3 probeIrradiance(vec3 viewNormal){vec3 N=viewNormal*viewRotation;
vec3 E=${irradianceShader((k) => `probeSh[${k}]`, 'N')};
return max(E,vec3(0.0));}`;

/** A host light probe read by shape: its intensity and its nine RGB coefficients. */
export type ProbeLight = {
  intensity: number;
  sh: { coefficients: ArrayLike<{ x: number; y: number; z: number }> };
};

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
  add(probe: ProbeLight) {
    const { coefficients } = probe.sh;
    for (let k = 0; k < ENVIRONMENT_COEFFICIENTS; k++) {
      const c = coefficients[k];
      this.sh[k * 3] += c.x * probe.intensity;
      this.sh[k * 3 + 1] += c.y * probe.intensity;
      this.sh[k * 3 + 2] += c.z * probe.intensity;
    }
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
