import { normalMatrix3 } from '../../../../sdk-core/src/index.ts';
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import { LTC_UNIT } from './rectGlsl.ts';

/**
 * The model-view and normal matrices of the draws, sent only when the drawn node's world matrix
 * differs from the last one sent (#840): the pages of one placement share it, and a frame of
 * sponza drew 1 465 of them, twice, each with 100 bytes of matrices the context already held —
 * enough to fill its command buffer while the GPU process waited on the compositor. True when
 * sent: the winding the matrix gives is read again then. `forget` at every draw — its camera's
 * view may have moved — and wherever the raster state is forgotten.
 */
export class ModelUniforms {
  private model = new Float64Array(16).fill(Number.NaN);
  private modelView = new Float64Array(16);
  private upload = new Float32Array(16);
  private normal = new Float32Array(9);
  private gl: WebGL2RenderingContext;
  private at: [WebGLUniformLocation | null, WebGLUniformLocation | null];
  constructor(
    gl: WebGL2RenderingContext,
    modelView: WebGLUniformLocation | null,
    normal: WebGLUniformLocation | null,
  ) {
    this.gl = gl;
    this.at = [modelView, normal];
  }
  set(view: ArrayLike<number>, model: ArrayLike<number>) {
    let i = 0;
    while (i < 16 && this.model[i] === model[i]) i++;
    if (i === 16) return false;
    this.model.set(model);
    multiplyMatrix4Typed(this.modelView, view, model);
    this.upload.set(this.modelView);
    this.gl.uniformMatrix4fv(this.at[0], false, this.upload);
    normalMatrix3(this.normal, this.modelView);
    this.gl.uniformMatrix3fv(this.at[1], false, this.normal);
    return true;
  }
  forget() {
    this.model.fill(Number.NaN);
  }
}

export class Matrix3UniformCache {
  private values = new Map<string, Float32Array>();
  private gl: WebGL2RenderingContext;
  private location: (name: string) => WebGLUniformLocation | null;
  constructor(gl: WebGL2RenderingContext, location: (name: string) => WebGLUniformLocation | null) {
    this.gl = gl;
    this.location = location;
  }
  /** The nine elements the caller holds, read-only: the cache copies them before the upload. */
  set(name: string, value: ArrayLike<number>) {
    let previous = this.values.get(name);
    if (!previous) {
      previous = new Float32Array(9);
      previous.fill(Number.NaN);
      this.values.set(name, previous);
    }
    for (let i = 0; i < 9; i++)
      if (previous[i] !== value[i]) {
        previous.set(value);
        this.gl.uniformMatrix3fv(this.location(name), false, previous);
        return;
      }
  }
}

export const setClusterSamplers = (
  gl: WebGL2RenderingContext,
  location: (name: string) => WebGLUniformLocation | null,
) => {
  const names = [
    'baseMap',
    'roughMap',
    'metalMap',
    'normalMap',
    'aoMap',
    'emissiveMap',
    'backdrop',
    'backdropDepth',
  ];
  for (let unit = 0; unit < names.length; unit++) gl.uniform1i(location(names[unit]), unit);
  gl.uniform1i(location('ltcTable'), LTC_UNIT);
  gl.uniform1i(location('reflectionColor'), LTC_UNIT + 1);
  gl.uniform1i(location('reflectionDepth'), LTC_UNIT + 2);
};
