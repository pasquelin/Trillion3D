export class Matrix3UniformCache {
  private values = new Map<string, Float32Array>();
  private gl: WebGL2RenderingContext;
  private location: (name: string) => WebGLUniformLocation | null;
  constructor(gl: WebGL2RenderingContext, location: (name: string) => WebGLUniformLocation | null) {
    this.gl = gl;
    this.location = location;
  }
  set(name: string, value: Float32List) {
    let previous = this.values.get(name);
    if (!previous) {
      previous = new Float32Array(9);
      previous.fill(Number.NaN);
      this.values.set(name, previous);
    }
    for (let i = 0; i < 9; i++)
      if (previous[i] !== value[i]) {
        this.gl.uniformMatrix3fv(this.location(name), false, value);
        previous.set(value);
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
};

export const setMatrix3 = (
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  value: Float32List,
) => gl.uniformMatrix3fv(location, false, value);
