import {
  DEFORMATION_ROW_TEXELS,
  geometryDeformationBytes,
  morphTargets,
} from '../../deformation/textureBytes.ts'
import { refuseCluster } from './refusal.ts'
import { deformationTexels } from '../../deformation/vertexTexture.ts'
import { skinStreams } from '../../../../sdk-core/src/world/geometry/skin.ts'
import type { Geometry as SourceGeometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { ClusterDraw, WholeMesh } from '../../cluster/batchMesh.ts'
import { allocated } from '../core/allocation.ts'
import { FLOAT_TEXELS, LIGHT_LIST_UNIT, WebglLightTexture } from './lightTexture.ts'

/** The units of the deformation block and of a draw's morph displacements, past the lights'. */
export const DEFORM_BLOCK_UNIT = LIGHT_LIST_UNIT + 1
export const MORPH_DELTAS_UNIT = LIGHT_LIST_UNIT + 2

/** A session's deformation records (`../../deformation/frame.ts`): the block and its words, each
 *  placement's record (its first float plus one), and a count moved whenever the block was
 *  rewritten. */
export type DeformationSource = {
  readonly block: Float32Array
  readonly words: Uint32Array
  readonly bases: Uint32Array
  readonly version: number
}

/** A drawn page mesh that names its placement's record (`deformRecord`, zero or absent: none). */
export type DeformedDraw = { deformRecord?: number }
export const deformRecordOf = (draw: ClusterDraw) => (draw as DeformedDraw).deformRecord ?? 0

type Geometry = WholeMesh['geometry']

/**
 * THE WEBGL2 SIDE OF THE DEFORMATION STAGE: the session's records sent as one float
 * texture (`WebglLightTexture`, the lights' growable rows) whenever the block moved, each record's
 * head counts rewritten as float values — a texel keeps a value, not a word's bits — and, per
 * draw, `deformDraw`: its record, whether its page is skinned and its targets, whose
 * displacements a texture of its own geometry holds, made at its first draw and freed with it.
 */
export class WebglClusterDeformation {
  private block: WebglLightTexture<Float32Array> | undefined
  private morphs = new Map<Geometry, WebGLTexture>()
  /** Each drawn geometry's skin width and target count, fixed with it: read once, not per draw. */
  private counts = new WeakMap<Geometry, { skin: number; targets: number }>()
  private sent = -1
  private source: DeformationSource | undefined
  private gl: WebGL2RenderingContext
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
  }
  /** The frame's records, sent when they moved since the last frame sent them; bound either way. */
  beginFrame(source: DeformationSource | undefined) {
    this.source = source
    if (!source) return
    this.block ??= new WebglLightTexture(
      this.gl,
      DEFORM_BLOCK_UNIT,
      FLOAT_TEXELS,
      Float32Array,
      'geometry',
      () => {
        this.sent = -1
      },
    )
    if (source.version === this.sent) return this.block.bind()
    const texels = Math.ceil(source.block.length / 4)
    this.block.reserve(texels)
    const data = this.block.data,
      words = source.words
    data.set(source.block)
    for (const base of source.bases)
      for (let k = base - 1; base && k < base + 6; k++) data[k] = words[k]
    this.block.upload(texels)
    this.sent = source.version
  }
  /** What `draw` deforms by — its record, whether its page is skinned, its targets — written in
   *  `out` as `deformDraw` reads it, the targets' texture bound. */
  of(draw: ClusterDraw, geometry: Geometry, out: Int32Array) {
    const record = this.source ? deformRecordOf(draw) : 0
    let counts = record ? this.counts.get(geometry) : undefined
    if (record && !counts) {
      counts = {
        skin: skinStreams(geometry as SourceGeometry).width,
        targets: morphTargets(geometry as SourceGeometry),
      }
      this.counts.set(geometry, counts)
    }
    out[0] = record
    out[1] = counts?.skin ?? 0
    out[2] = counts?.targets ?? 0
    if (out[1] || out[2]) this.bindMorph(geometry)
  }
  /** The geometry's displacements as texels, two a target per vertex — position, then normal. */
  private bindMorph(geometry: Geometry) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + MORPH_DELTAS_UNIT)
    let texture = this.morphs.get(geometry)
    if (texture) return void gl.bindTexture(gl.TEXTURE_2D, texture)
    const bytes = geometryDeformationBytes(geometry as SourceGeometry),
      texels = bytes / 16,
      rows = texels / DEFORMATION_ROW_TEXELS
    const most = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
    if (rows > most || DEFORMATION_ROW_TEXELS > most)
      refuseCluster(`${texels} deformation texels exceed the ${most}-side texture of this device`)
    const data = new Float32Array(bytes / 4)
    data.set(
      deformationTexels(geometry as SourceGeometry, morphTargets(geometry as SourceGeometry)),
    )
    texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      DEFORMATION_ROW_TEXELS,
      rows,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    )
    allocated(gl, 'geometry', () => this.forget(geometry))
    this.morphs.set(geometry, texture)
    geometry.released?.add(() => this.forget(geometry))
  }
  private forget(geometry: Geometry) {
    const texture = this.morphs.get(geometry)
    if (!texture) return
    this.morphs.delete(geometry)
    this.gl.deleteTexture(texture)
  }
  dispose() {
    for (const texture of this.morphs.values()) this.gl.deleteTexture(texture)
    this.morphs.clear()
    this.block?.dispose()
  }
}
