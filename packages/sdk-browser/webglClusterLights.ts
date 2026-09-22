import { LTC_SIZE, ltcTable } from '../sdk-core/ltcTable.ts';
import { LTC_UNIT, WEBGL_RECT_KIND } from './webglClusterRectGlsl.ts';

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
  isRectAreaLight?: boolean;
  /** A rectangle's size along its local x and y. */
  width?: number;
  height?: number;
  type: string;
  color: { r: number; g: number; b: number };
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  target?: MatrixNode;
};
/** A host scene background read by shape: a colour, in linear components, or anything else. */
export type SceneColour = { isColor?: boolean; r: number; g: number; b: number } | null | undefined;
export type WebglClusterScene = {
  traverse(visitor: (entry: MatrixNode) => void): void;
  /** Host background: a colour clears the transmission backdrop, anything else clears to black. */
  background?: SceneColour | object;
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
      !light.isSpotLight &&
      !light.isRectAreaLight
    )
      reason = `${light.type} is unsupported`;
    else if ((light.isPointLight || light.isSpotLight) && light.decay !== 2)
      reason = `${light.type} decay ${light.decay} is unsupported; inverse-square decay 2 is required`;
  });
  return (
    reason ?? (count > 64 ? `${count} visible lights exceed the 64-light contract` : undefined)
  );
};

/** The fitted lobe of the rectangles (`ltcTable.ts`) as a float texture read by `texelFetch`:
 *  two texels a cell, no filtering asked of the device. */
function createLtcTexture(gl: WebGL2RenderingContext) {
  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + LTC_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    LTC_SIZE * 2,
    LTC_SIZE,
    0,
    gl.RGBA,
    gl.FLOAT,
    ltcTable(),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

export class WebglClusterLights {
  private data = new Float32Array(4 * 4 * 64);
  private buffer: WebGLBuffer;
  private ltc: WebGLTexture;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'ClusterLights'), 0);
    this.ltc = createLtcTexture(gl);
  }
  upload(scene: WebglClusterScene, view: ArrayLike<number>) {
    let count = 0;
    const data = this.data;
    // Everything is written in place: nothing is allocated per light.
    const write = (at: number, x: number, y: number, z: number, w: number) => {
      data[at] = x;
      data[at + 1] = y;
      data[at + 2] = z;
      data[at + 3] = w;
    };
    /** Direction (x, y, z) carried into view space and scaled by `s`, `w` beside it. */
    const toView = (at: number, x: number, y: number, z: number, s: number, w: number) =>
      write(
        at,
        (view[0] * x + view[4] * y + view[8] * z) * s,
        (view[1] * x + view[5] * y + view[9] * z) * s,
        (view[2] * x + view[6] * y + view[10] * z) * s,
        w,
      );
    /** Column `c` of a world matrix, unit, carried into view space and scaled by `s`. */
    const axis = (at: number, m: ArrayLike<number>, c: number, s: number, w: number) =>
      toView(at, m[c], m[c + 1], m[c + 2], s / (Math.hypot(m[c], m[c + 1], m[c + 2]) || 1), w);
    scene.traverse((entry) => {
      const light = entry as ClusterLight;
      if (!light.isLight || !visibleThroughParents(light)) return;
      let kind = 3,
        range = 0,
        inner = 1,
        outer = 1;
      const matrix = light.matrixWorld.elements;
      const px = matrix[12],
        py = matrix[13],
        pz = matrix[14];
      let dx = 0,
        dy = 0,
        dz = -1;
      if (light.isDirectionalLight) kind = 0;
      else if (light.isPointLight) {
        kind = 1;
        range = light.distance ?? 0;
      } else if (light.isRectAreaLight) {
        kind = WEBGL_RECT_KIND;
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
      const base = count++ * 16;
      write(
        base,
        view[0] * px + view[4] * py + view[8] * pz + view[12],
        view[1] * px + view[5] * py + view[9] * pz + view[13],
        view[2] * px + view[6] * py + view[10] * pz + view[14],
        range,
      );
      write(base + 8, light.color.r, light.color.g, light.color.b, light.intensity);
      if (kind === WEBGL_RECT_KIND) {
        // It emits down its local -z; its width runs along its local x.
        axis(base + 4, matrix, 8, -1, kind);
        axis(base + 12, matrix, 0, light.width! / 2, light.height! / 2);
        return;
      }
      toView(base + 4, dx, dy, dz, 1, kind);
      write(base + 12, inner, outer, 0, 0);
    });
    const gl = this.gl;
    // The host's texture units are unknown at frame start: the lobe is bound again every frame.
    gl.activeTexture(gl.TEXTURE0 + LTC_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.ltc);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    if (count > 0) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data, 0, count * 16);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
    return count;
  }
  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteTexture(this.ltc);
  }
}
