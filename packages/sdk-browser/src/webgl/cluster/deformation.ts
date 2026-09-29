import { deformationTexels } from '../../deformation/vertexTexture.ts';
import { skinStreams } from '../../../../sdk-core/src/world/geometry/skin.ts';
import type { Geometry as SourceGeometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { ClusterDraw, WholeMesh } from '../../cluster/batchMesh.ts';
import { allocated } from '../core/allocation.ts';
import {
  FLOAT_TEXELS,
  LIGHT_LIST_UNIT,
  LIGHT_ROW_TEXELS,
  WebglLightTexture,
} from './lightTexture.ts';

/** The units of the deformation block and of a draw's morph displacements, past the lights'. */
export const DEFORM_BLOCK_UNIT = LIGHT_LIST_UNIT + 1;
export const MORPH_DELTAS_UNIT = LIGHT_LIST_UNIT + 2;

/** A session's deformation records (`../../deformation/frame.ts`): the block, each placement's
 *  record (its first float plus one), and a count moved whenever the block was rewritten. */
export type DeformationSource = {
  readonly block: Float32Array;
  readonly bases: Uint32Array;
  readonly version: number;
};

/** A drawn page mesh that names its placement's record (`deformRecord`, zero or absent: none). */
export type DeformedDraw = { deformRecord?: number };
export const deformRecordOf = (draw: ClusterDraw) => (draw as DeformedDraw).deformRecord ?? 0;

type Geometry = WholeMesh['geometry'];

/** Morph targets a page geometry carries: its `morph` attribute holds six floats of each a vertex
 *  (`../../page/decode/geometryPage.ts`). */
function targetsOf(geometry: Geometry) {
  const morph = geometry.attributes.morph,
    vertices = geometry.attributes.position?.count ?? 0;
  return morph && vertices
    ? morph.array.length / (6 * vertices)
    : ((geometry as SourceGeometry).morphAttributes?.position?.length ?? 0);
}

/**
 * THE WEBGL2 SIDE OF THE DEFORMATION STAGE (#357): the session's records sent as one float
 * texture (`WebglLightTexture`, the lights' growable rows) whenever the block moved, each record's
 * head counts rewritten as float values — a texel keeps a value, not a word's bits — and, per
 * draw, `deformDraw`: its record, whether its page is skinned and its targets, whose
 * displacements a texture of its own geometry holds, made at its first draw and freed with it.
 */
export class WebglClusterDeformation {
  private block: WebglLightTexture<Float32Array>;
  private morphs = new Map<Geometry, WebGLTexture>();
  private sent = -1;
  private source: DeformationSource | undefined;
  /** The block's words, read to write its heads' counts as values. */
  private words: Uint32Array | undefined;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.block = new WebglLightTexture(gl, DEFORM_BLOCK_UNIT, FLOAT_TEXELS, Float32Array);
  }
  /** The frame's records, sent when they moved since the last frame sent them; bound either way. */
  beginFrame(source: DeformationSource | undefined) {
    this.source = source;
    if (!source || source.version === this.sent) return this.block.bind();
    const texels = Math.ceil(source.block.length / 4);
    this.block.reserve(texels);
    if (this.words?.buffer !== source.block.buffer)
      this.words = new Uint32Array(
        source.block.buffer,
        source.block.byteOffset,
        source.block.length,
      );
    const data = this.block.data,
      words = this.words;
    data.set(source.block);
    for (const base of source.bases)
      for (let k = base - 1; base && k < base + 6; k++) data[k] = words[k];
    this.block.upload(texels);
    this.sent = source.version;
  }
  /** What `draw` deforms by — its record, whether its page is skinned, its targets — written in
   *  `out` as `deformDraw` reads it, the targets' texture bound. */
  of(draw: ClusterDraw, geometry: Geometry, out: Int32Array) {
    const record = this.source ? deformRecordOf(draw) : 0;
    out[0] = record;
    out[1] = record ? skinStreams(geometry as SourceGeometry).width : 0;
    out[2] = record ? targetsOf(geometry) : 0;
    if (out[1] || out[2]) this.bindMorph(geometry);
  }
  /** The geometry's displacements as texels, two a target per vertex — position, then normal. */
  private bindMorph(geometry: Geometry) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + MORPH_DELTAS_UNIT);
    let texture = this.morphs.get(geometry);
    if (texture) return void gl.bindTexture(gl.TEXTURE_2D, texture);
    const deltas = deformationTexels(geometry as SourceGeometry, targetsOf(geometry)),
      texels = deltas.length / 4,
      rows = Math.ceil(texels / LIGHT_ROW_TEXELS),
      data = new Float32Array(rows * LIGHT_ROW_TEXELS * 4);
    data.set(deltas);
    texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LIGHT_ROW_TEXELS, rows, 0, gl.RGBA, gl.FLOAT, data);
    allocated(gl, 'geometry', () => this.forget(geometry));
    this.morphs.set(geometry, texture);
    geometry.released?.add(() => this.forget(geometry));
  }
  private forget(geometry: Geometry) {
    const texture = this.morphs.get(geometry);
    if (!texture) return;
    this.morphs.delete(geometry);
    this.gl.deleteTexture(texture);
  }
  dispose() {
    for (const texture of this.morphs.values()) this.gl.deleteTexture(texture);
    this.morphs.clear();
    this.block.dispose();
  }
}
