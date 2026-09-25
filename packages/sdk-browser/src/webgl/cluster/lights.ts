import { LTC_UNIT, createLtcTexture } from './rectGlsl.ts';
import { inReferenceOrder } from './lightOrder.ts';
import { WebglClusterProbe } from './probe.ts';
import { WebglClusterFog } from './fog.ts';
import type { SceneFog } from '../../../../sdk-core/src/scene/core/fog.ts';
import { isLightNode } from '../../host/graph/kinds.ts';
import type { GraphLight, GraphRectLight } from '../../host/graph/light.ts';

type MatrixNode = {
  visible: boolean;
  parent: MatrixNode | null;
  matrixWorld: { elements: ArrayLike<number> };
};
/** A light that takes a slot of the program: one that aims or reaches, or a rectangle. */
type DirectLight = GraphLight | GraphRectLight;

/** The ambient irradiance a frame sums (r, g, b, and whether any ambient light counted), reused. */
const AMBIENT = new Float64Array(4);

/** A host scene background read by shape: a colour, in linear components, or anything else. */
export type SceneColour = { isColor?: boolean; r: number; g: number; b: number } | null | undefined;
export type WebglClusterScene = {
  traverse(visitor: (entry: MatrixNode) => void): void;
  /** Host background: a colour clears the transmission backdrop, anything else clears to black. */
  background?: SceneColour | object;
  /** The contract's fog, over every drawn surface; none when absent. */
  fog?: SceneFog | null;
};

const visibleThroughParents = (object: MatrixNode) => {
  for (let current: MatrixNode | null = object; current; current = current.parent)
    if (!current.visible) return false;
  return true;
};

export const unsupportedClusterLight = (scene: WebglClusterScene) => {
  let reason: string | undefined;
  let count = 0,
    ambient = 0;
  scene.traverse((light) => {
    // A probe takes no light slot: its coefficients add into the program's irradiance.
    if (!isLightNode(light) || light.kind === 'probe' || !visibleThroughParents(light)) return;
    // The ambient lights share one slot: `upload` sums them into a single irradiance.
    if (light.kind === 'ambient') ambient = 1;
    else count++;
    if ((light.kind === 'point' || light.kind === 'spot') && light.decay !== 2)
      reason = `${light.kind} light decay ${light.decay} is unsupported; inverse-square decay 2 is required`;
  });
  return (
    reason ??
    (count + ambient > 64
      ? `${count + ambient} light slots exceed the 64-light contract`
      : undefined)
  );
};

export class WebglClusterLights {
  private data = new Float32Array(4 * 4 * 64);
  /** The direct lights of the frame, in the graph's order; reused from frame to frame. */
  private lights: DirectLight[] = [];
  private buffer: WebGLBuffer;
  private ltc: WebGLTexture;
  private probe: WebglClusterProbe;
  private fog: WebglClusterFog;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'ClusterLights'), 0);
    this.ltc = createLtcTexture(gl);
    this.probe = new WebglClusterProbe(gl, program);
    this.fog = new WebglClusterFog(gl, program);
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
    this.probe.reset();
    const lights = this.lights;
    lights.length = 0;
    const ambient = AMBIENT.fill(0);
    scene.traverse((light) => {
      if (!isLightNode(light) || !visibleThroughParents(light)) return;
      if (light.kind === 'probe') return this.probe.add(light);
      if (light.kind !== 'ambient') return void lights.push(light);
      ambient[0] += light.color.r * light.intensity;
      ambient[1] += light.color.g * light.intensity;
      ambient[2] += light.color.b * light.intensity;
      ambient[3] = 1;
    });
    // The reference's order: the points, the spots, the suns, the rectangles, the shadow casters
    // first within a kind; the ambient lights are one irradiance, summed here.
    inReferenceOrder(lights, writeLight);
    if (ambient[3]) {
      write(count * 16 + 4, 0, 0, -1, 3);
      write(count++ * 16 + 8, ambient[0], ambient[1], ambient[2], 1);
    }
    function writeLight(light: DirectLight, kind: number) {
      const lamp = light.kind === 'rect' ? undefined : light;
      let range = 0,
        inner = 1,
        outer = 1;
      const matrix = light.matrixWorld.elements;
      const px = matrix[12],
        py = matrix[13],
        pz = matrix[14];
      let dx = 0,
        dy = 0,
        dz = 0;
      if (kind !== 0) range = light.distance ?? 0;
      if (kind === 2) {
        outer = Math.cos(lamp!.angle ?? 0);
        inner = Math.cos((lamp!.angle ?? 0) * (1 - (lamp!.penumbra ?? 0)));
      }
      if (kind === 0 || kind === 2) {
        // Toward the light, in view space, unit: the reference's direction, normalised once here
        // and read as is by the program.
        const target = lamp!.target!.matrixWorld.elements;
        const x = px - target[12],
          y = py - target[13],
          z = pz - target[14];
        dx = view[0] * x + view[4] * y + view[8] * z;
        dy = view[1] * x + view[5] * y + view[9] * z;
        dz = view[2] * x + view[6] * y + view[10] * z;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
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
      if (light.kind === 'rect') {
        write(base + 8, light.color.r, light.color.g, light.color.b, light.intensity);
        // It emits down its local -z; its width runs along its local x.
        axis(base + 4, matrix, 8, -1, kind);
        axis(base + 12, matrix, 0, light.width / 2, light.height / 2);
        return;
      }
      // The colour scaled by the intensity here, in double precision, as the reference uploads it.
      const i = light.intensity;
      write(base + 8, light.color.r * i, light.color.g * i, light.color.b * i, 1);
      write(base + 4, dx, dy, dz, kind);
      write(base + 12, inner, outer, lamp!.decay ?? 2, 0);
    }
    this.probe.upload(view);
    this.fog.upload(scene.fog, view);
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
