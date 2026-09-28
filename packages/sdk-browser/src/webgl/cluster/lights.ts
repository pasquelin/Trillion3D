import { LTC_UNIT, createLtcTexture } from './rectGlsl.ts';
import { FLOAT_TEXELS, LIGHT_DATA_UNIT, WebglLightTexture } from './lightTexture.ts';
import { REACH_FLOATS, WebglClusterLightLists } from './lightLists.ts';
import type { ClusterDraw } from '../../cluster/batchMesh.ts';
import { inReferenceOrder } from './lightOrder.ts';
import { WebglClusterProbe } from './probe.ts';
import { WebglClusterFog } from './fog.ts';
import { sceneFogOf, type Fog } from '../../world/core/sceneFog.ts';
import type { SceneFog } from '../../../../sdk-core/src/scene/core/fog.ts';
import { isLightNode } from '../../host/graph/kinds.ts';
import { shownChain } from '../../placement/hidden.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts';

/** The ambient irradiance a frame sums (r, g, b, and whether any ambient light counted), reused. */
const AMBIENT = new Float64Array(4);

/** A host scene background read by shape: a colour, in linear components, or anything else. */
export type SceneColour = { isColor?: boolean; r: number; g: number; b: number } | null | undefined;
export type WebglClusterScene = {
  traverse(visitor: (entry: object) => void): void;
  /** Host background: a colour clears the transmission backdrop, anything else clears to black. */
  background?: SceneColour | object;
  /** The contract's fog, over every drawn surface; none when absent. */
  fog?: Fog | null;
};

/** The kinds that take a slot of this path; a probe adds into the irradiance instead. */
const DRAWN = new Set(['directional', 'point', 'spot', 'rectArea', 'ambient']);

export const unsupportedClusterLight = (scene: WebglClusterScene) => {
  let reason: string | undefined;
  scene.traverse((light) => {
    // A probe takes no light slot: its coefficients add into the program's irradiance.
    if (!isLightNode(light) || light.kind === 'probe' || !shownChain(light)) return;
    // A world's sky over a ground reaches this path as the environment's irradiance, a probe.
    if (!DRAWN.has(light.kind))
      reason ??= `${light.kind} light is not drawn by the WebGL2 cluster path`;
    if ((light.kind === 'point' || light.kind === 'spot') && light.decay !== 2)
      reason = `${light.kind} light decay ${light.decay} is unsupported; inverse-square decay 2 is required`;
  });
  return reason;
};

/**
 * The frame's lights, as many as the scene holds: four vec4 records a slot in a float texture
 * grown with the count (`./lightTexture.ts`), and each slot's reach in the per-draw lists.
 */
export class WebglClusterLights {
  private records: WebglLightTexture<Float32Array>;
  /** The lights each draw reaches, listed once the frame's slots are written. */
  readonly lists: WebglClusterLightLists;
  /** The direct lights of the frame, in the graph's order; reused from frame to frame. */
  private lights: Light[] = [];
  private ltc: WebGLTexture;
  private probe: WebglClusterProbe;
  private fog: WebglClusterFog;
  /** The scene's fog last read, and the lighting's form of it: read again when it is replaced. */
  private heldFog: Fog | null | undefined = null;
  private readFog: SceneFog | undefined;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.records = new WebglLightTexture(gl, LIGHT_DATA_UNIT, FLOAT_TEXELS, Float32Array);
    this.lists = new WebglClusterLightLists(gl);
    this.ltc = createLtcTexture(gl);
    this.probe = new WebglClusterProbe(gl, program);
    this.fog = new WebglClusterFog(gl, program);
  }
  /** Writes the frame's lights, then the list of the lights each of `draws` reaches. */
  upload(
    scene: WebglClusterScene,
    view: ArrayLike<number>,
    draws: readonly (readonly ClusterDraw[])[] = [],
  ) {
    let count = 0,
      data: Float32Array;
    const lists = this.lists;
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
      toView(at, m[c], m[c + 1], m[c + 2], s / (hypot3(m[c], m[c + 1], m[c + 2]) || 1), w);
    this.probe.reset();
    const lights = this.lights;
    lights.length = 0;
    const ambient = AMBIENT.fill(0);
    scene.traverse((light) => {
      if (!isLightNode(light) || !shownChain(light)) return;
      if (light.kind === 'probe') return this.probe.add(light);
      if (light.kind !== 'ambient') return void lights.push(light);
      ambient[0] += light.color.r * light.intensity;
      ambient[1] += light.color.g * light.intensity;
      ambient[2] += light.color.b * light.intensity;
      ambient[3] = 1;
    });
    // A slot a light, the ambient lights one more: the texture and the reach grow to hold them.
    this.records.reserve((lights.length + 1) * 4);
    lists.reserve(lights.length + 1);
    data = this.records.data;
    // The reference's order: the points, the spots, the suns, the rectangles, the shadow casters
    // first within a kind; the ambient lights are one irradiance, summed here.
    inReferenceOrder(lights, writeLight);
    if (ambient[3]) {
      lists.reach.fill(0, count * REACH_FLOATS, (count + 1) * REACH_FLOATS);
      write(count * 16 + 4, 0, 0, -1, 3);
      write(count++ * 16 + 8, ambient[0], ambient[1], ambient[2], 1);
    }
    function writeLight(light: Light, kind: number) {
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
      if (kind !== 0) range = light.distance;
      if (kind === 2) {
        outer = Math.cos(light.angle);
        inner = Math.cos(light.angle * (1 - light.penumbra));
      }
      if (kind === 0 || kind === 2) {
        // Toward the light, in view space, unit: the reference's direction, normalised once here
        // and read as is by the program.
        const target = light.target.matrixWorld.elements;
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
      // The world centre and range the draw lists test; a sun, or a lamp of no range, reaches all.
      const reach = lists.reach,
        at = count * REACH_FLOATS;
      reach[at] = px;
      reach[at + 1] = py;
      reach[at + 2] = pz;
      reach[at + 3] = range > 0 ? range : 0;
      const base = count++ * 16;
      write(
        base,
        view[0] * px + view[4] * py + view[8] * pz + view[12],
        view[1] * px + view[5] * py + view[9] * pz + view[13],
        view[2] * px + view[6] * py + view[10] * pz + view[14],
        range,
      );
      if (light.kind === 'rectArea') {
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
      write(base + 12, inner, outer, light.decay, 0);
    }
    this.probe.upload(view);
    if (scene.fog !== this.heldFog) this.readFog = sceneFogOf((this.heldFog = scene.fog) ?? null);
    this.fog.upload(this.readFog, view);
    const gl = this.gl;
    this.records.upload(count * 4);
    lists.build(count, draws);
    // The host's texture units are unknown at frame start: the lobe is bound again every frame,
    // last, so the active unit stays the one it always was.
    gl.activeTexture(gl.TEXTURE0 + LTC_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.ltc);
    return count;
  }
  dispose() {
    this.records.dispose();
    this.lists.dispose();
    this.gl.deleteTexture(this.ltc);
  }
}
