import { isInstancedNode } from '../../host/graph/kinds.ts';
import { drawWorld, isClusterDrawMesh, type ClusterDraw } from '../../cluster/batchMesh.ts';
import { visMaterial } from '../../visibility/shader/material.ts';
import { readHostBox } from '../../host/boxBounds.ts';
import { placementsBox } from './copyCulling.ts';
import { INT_TEXELS, LIGHT_LIST_UNIT, WebglLightTexture } from './lightTexture.ts';
import {
  BOX_VALUES,
  boxPointDistance,
  boxTransform,
} from '../../../../sdk-core/src/math/primitives/box.ts';
import { grown } from '../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { spanBox } from '../../../../sdk-core/src/world/geometry/bounds.ts';
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import type { HostAttributes } from '../../host/resources.ts';

/** Floats a light slot's reach takes: its world centre, then its range (0: every draw). */
export const REACH_FLOATS = 4;
const NO_MORPH = {};
const scratch = new Box3();
/** A position list's local box, kept while the list is the same version. */
const kept = new WeakMap<object, { version: number; box: Float64Array }>();

/** The local box of a geometry's positions, measured once per version of the list: a batch
 *  record's geometry carries no box of its own. */
function localBox(attributes: HostAttributes) {
  const position = attributes.position,
    version = (position as { version?: number }).version ?? 0;
  const held = kept.get(position);
  if (held && held.version === version) return held.box;
  const box = new Float64Array(BOX_VALUES);
  const morphed = { attributes, morphAttributes: NO_MORPH, morphTargetsRelative: false };
  readHostBox(box, spanBox(scratch, morphed));
  kept.set(position, { version, box });
  return box;
}

/** A draw's world box into `out`: its positions carried by its placement, or for an instanced
 *  mesh the box its frustum test takes (`placementsBox`). */
function drawWorldBox(out: Float64Array, draw: ClusterDraw) {
  if (!isClusterDrawMesh(draw) && isInstancedNode(draw)) placementsBox(out, draw);
  else out.set(localBox(draw.geometry.attributes));
  boxTransform(out, 0, out, 0, drawWorld(draw));
  return out;
}

/** A line widened or a sprite turned on screen leaves its positions' box: it takes every light. */
const leavesItsBox = (draw: ClusterDraw) => {
  const surface = visMaterial(draw.material);
  return (surface.lineWidth ?? 0) > 0 || !!surface.sprite;
};

/**
 * THE PER-DRAW LIGHT LISTS OF THE WEBGL2 PATH: each draw of a frame lists, in slot order, the
 * lights whose range reaches its world box — a sun, an ambient or a lamp of no range reaches
 * every draw —, so a draw evaluates the lamps near it and a scene of hundreds costs what the lamps
 * in reach cost. A light left out adds nothing where it is left out: its range window is zero past
 * its range. The lists sit end to end in one integer texture; a draw reads its span.
 */
export class WebglClusterLightLists {
  /** Each slot's reach, `REACH_FLOATS` a slot, written by the upload of the lights. */
  reach = new Float64Array(0);
  private lights = 0;
  private length = 0;
  /** Each listed draw's number this frame, and the start and length of its list. */
  private spans = new Map<object, number>();
  private starts = new Int32Array(0);
  private counts = new Int32Array(0);
  private box = new Float64Array(BOX_VALUES);
  private texture: WebglLightTexture<Int32Array>;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.texture = new WebglLightTexture(gl, LIGHT_LIST_UNIT, INT_TEXELS, Int32Array);
  }
  /** Room for `count` slots' reach, before the lights write it. */
  reserve(count: number) {
    if (this.reach.length < count * REACH_FLOATS)
      this.reach = grown(this.reach, Float64Array, count * 2 * REACH_FLOATS);
  }
  /** Lists every draw of the frame against the `count` lights uploaded, then sends the lists. */
  build(count: number, draws: readonly (readonly ClusterDraw[])[]) {
    this.lights = count;
    this.length = 0;
    this.spans.clear();
    this.ranged = false;
    for (let at = 3; at < count * REACH_FLOATS; at += REACH_FLOATS)
      if (this.reach[at] > 0) this.ranged = true;
    for (const list of draws) for (const draw of list) this.list(draw);
    this.texture.upload(this.length);
  }
  /** `draw`'s list, by number; a draw the frame did not list is listed and sent now, never drawn
   *  unlit. */
  listOf(draw: ClusterDraw) {
    let k = this.spans.get(draw);
    if (k === undefined) {
      k = this.list(draw);
      this.texture.upload(this.length);
    }
    return k;
  }
  /** Whether two lists read the same span: equal lists listed in a row share one (`list`). */
  same(a: number, b: number) {
    return this.starts[a] === this.starts[b] && this.counts[a] === this.counts[b];
  }
  /** Points the program's `lightSpan` at list `k` (`listOf`). */
  use(k: number, lightSpan: WebGLUniformLocation | null) {
    this.gl.uniform2i(lightSpan, this.starts[k], this.counts[k]);
  }
  /** Whether a light of the frame has a range: none, every draw takes every light, unmeasured. */
  private ranged = false;
  /** A draw's list, written at the end of the texture, or the previous list's span when it holds
   *  the same lights: the draws of a run then read one span (`runs.ts`). */
  private list(draw: ClusterDraw) {
    const known = this.spans.get(draw);
    if (known !== undefined) return known;
    const k = this.spans.size;
    let start = this.length;
    const every = !this.ranged || leavesItsBox(draw),
      box = every ? this.box : drawWorldBox(this.box, draw),
      reach = this.reach;
    this.texture.reserve(start + this.lights);
    const entries = this.texture.data;
    for (let slot = 0, at = 0; slot < this.lights; slot++, at += REACH_FLOATS) {
      const range = reach[at + 3];
      if (
        every ||
        range <= 0 ||
        boxPointDistance(box, 0, reach[at], reach[at + 1], reach[at + 2]) <= range
      )
        entries[this.length++] = slot;
    }
    if (k > 0 && this.repeats(k - 1, start)) {
      start = this.starts[k - 1];
      this.length = this.starts[k - 1] + this.counts[k - 1];
    }
    if (k >= this.starts.length) {
      this.starts = grown(this.starts, Int32Array, Math.max(64, k * 2));
      this.counts = grown(this.counts, Int32Array, this.starts.length);
    }
    this.starts[k] = start;
    this.counts[k] = this.length - start;
    this.spans.set(draw, k);
    return k;
  }
  /** Whether the entries written from `start` repeat list `k`, the one written just before. */
  private repeats(k: number, start: number) {
    const from = this.starts[k],
      count = this.counts[k],
      entries = this.texture.data;
    if (from + count !== start || this.length - start !== count) return false;
    for (let i = 0; i < count; i++) if (entries[from + i] !== entries[start + i]) return false;
    return true;
  }
  dispose() {
    this.texture.dispose();
  }
}
