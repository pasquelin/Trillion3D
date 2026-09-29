import { LTC_UNIT } from './rectGlsl.ts';
import { LIGHT_DATA_UNIT, LIGHT_LIST_UNIT } from './lightTexture.ts';

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
  gl.uniform1i(location('lightData'), LIGHT_DATA_UNIT);
  gl.uniform1i(location('lightList'), LIGHT_LIST_UNIT);
};

export const setMatrix3 = (
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  value: Float32List,
) => gl.uniformMatrix3fv(location, false, value);
