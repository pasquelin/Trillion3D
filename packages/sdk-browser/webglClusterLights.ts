type MatrixNode = {
  visible: boolean;
  parent: MatrixNode | null;
  matrixWorld: { elements: ArrayLike<number> };
};
type ClusterLight = MatrixNode & {
  isLight?: boolean;
  isAmbientLight?: boolean;
  isDirectionalLight?: boolean;
  isPointLight?: boolean;
  isSpotLight?: boolean;
  type: string;
  color: { r: number; g: number; b: number };
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  target?: MatrixNode;
};
export type WebglClusterScene = {
  traverse(visitor: (entry: MatrixNode) => void): void;
  /** Host background: a colour clears the transmission backdrop, anything else clears to black. */
  background?: { isColor?: boolean; r: number; g: number; b: number } | object | null;
};

const visibleThroughParents = (object: MatrixNode) => {
  for (let current: MatrixNode | null = object; current; current = current.parent)
    if (!current.visible) return false;
  return true;
};

export const unsupportedClusterLight = (scene: WebglClusterScene) => {
  let reason: string | undefined;
  let count = 0;
  scene.traverse((entry) => {
    const light = entry as ClusterLight;
    if (!light.isLight || !visibleThroughParents(light)) return;
    count++;
    if (
      !light.isAmbientLight &&
      !light.isDirectionalLight &&
      !light.isPointLight &&
      !light.isSpotLight
    )
      reason = `${light.type} is unsupported`;
    else if ((light.isPointLight || light.isSpotLight) && light.decay !== 2)
      reason = `${light.type} decay ${light.decay} is unsupported; inverse-square decay 2 is required`;
  });
  return (
    reason ?? (count > 64 ? `${count} visible lights exceed the 64-light contract` : undefined)
  );
};

export class WebglClusterLights {
  private data = new Float32Array(4 * 4 * 64);
  private buffer: WebGLBuffer;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'ClusterLights'), 0);
  }
  upload(scene: WebglClusterScene, view: ArrayLike<number>) {
    let count = 0;
    const data = this.data;
    scene.traverse((entry) => {
      const light = entry as ClusterLight;
      if (!light.isLight || !visibleThroughParents(light)) return;
      let kind = 3,
        range = 0,
        inner = 1,
        outer = 1;
      const matrix = light.matrixWorld.elements;
      let px = matrix[12],
        py = matrix[13],
        pz = matrix[14];
      let dx = 0,
        dy = 0,
        dz = -1;
      if (light.isDirectionalLight) kind = 0;
      else if (light.isPointLight) {
        kind = 1;
        range = light.distance ?? 0;
      } else if (light.isSpotLight) {
        kind = 2;
        range = light.distance ?? 0;
        outer = Math.cos(light.angle ?? 0);
        inner = Math.cos((light.angle ?? 0) * (1 - (light.penumbra ?? 0)));
      }
      if (kind === 0 || kind === 2) {
        const target = light.target!.matrixWorld.elements;
        dx = target[12] - px;
        dy = target[13] - py;
        dz = target[14] - pz;
        const length = Math.hypot(dx, dy, dz) || 1;
        dx /= length;
        dy /= length;
        dz /= length;
      }
      const vx = view[0] * px + view[4] * py + view[8] * pz + view[12],
        vy = view[1] * px + view[5] * py + view[9] * pz + view[13],
        vz = view[2] * px + view[6] * py + view[10] * pz + view[14],
        vdx = view[0] * dx + view[4] * dy + view[8] * dz,
        vdy = view[1] * dx + view[5] * dy + view[9] * dz,
        vdz = view[2] * dx + view[6] * dy + view[10] * dz;
      px = vx;
      py = vy;
      pz = vz;
      const base = count++ * 16;
      data.set([px, py, pz, range], base);
      data.set([vdx, vdy, vdz, kind], base + 4);
      data.set([light.color.r, light.color.g, light.color.b, light.intensity], base + 8);
      data.set([inner, outer, 0, 0], base + 12);
    });
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    if (count > 0) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data, 0, count * 16);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
    return count;
  }
  dispose() {
    this.gl.deleteBuffer(this.buffer);
  }
}
