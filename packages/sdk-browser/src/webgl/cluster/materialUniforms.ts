export class WebglClusterMaterialUniforms {
  private values = new Float64Array(42).fill(Number.NaN);
  private gl: WebGL2RenderingContext;
  private at: (name: string) => WebGLUniformLocation | null;
  constructor(gl: WebGL2RenderingContext, at: (name: string) => WebGLUniformLocation | null) {
    this.gl = gl;
    this.at = at;
  }
  private same4(index: number, x: number, y: number, z: number, w: number) {
    return (
      this.values[index] === x &&
      this.values[index + 1] === y &&
      this.values[index + 2] === z &&
      this.values[index + 3] === w
    );
  }
  private store4(index: number, x: number, y: number, z: number, w: number) {
    this.values[index] = x;
    this.values[index + 1] = y;
    this.values[index + 2] = z;
    this.values[index + 3] = w;
  }
  f1(index: number, name: string, value: number) {
    if (this.values[index] === value) return;
    this.values[index] = value;
    this.gl.uniform1f(this.at(name), value);
  }
  i1(index: number, name: string, value: number) {
    if (this.values[index] === value) return;
    this.values[index] = value;
    this.gl.uniform1i(this.at(name), value);
  }
  f2(index: number, name: string, x: number, y: number) {
    if (this.values[index] === x && this.values[index + 1] === y) return;
    this.values[index] = x;
    this.values[index + 1] = y;
    this.gl.uniform2f(this.at(name), x, y);
  }
  f3(index: number, name: string, value: ArrayLike<number>) {
    if (
      this.values[index] === value[0] &&
      this.values[index + 1] === value[1] &&
      this.values[index + 2] === value[2]
    )
      return;
    this.values[index] = value[0];
    this.values[index + 1] = value[1];
    this.values[index + 2] = value[2];
    this.gl.uniform3f(this.at(name), value[0], value[1], value[2]);
  }
  f4(index: number, name: string, x: number, y: number, z: number, w: number) {
    if (this.same4(index, x, y, z, w)) return;
    this.store4(index, x, y, z, w);
    this.gl.uniform4f(this.at(name), x, y, z, w);
  }
  i2(index: number, name: string, x: number, y: number) {
    if (this.values[index] === x && this.values[index + 1] === y) return;
    this.values[index] = x;
    this.values[index + 1] = y;
    this.gl.uniform2i(this.at(name), x, y);
  }
  i4(index: number, name: string, x: number, y: number, z: number, w: number) {
    if (this.same4(index, x, y, z, w)) return;
    this.store4(index, x, y, z, w);
    this.gl.uniform4i(this.at(name), x, y, z, w);
  }
}
