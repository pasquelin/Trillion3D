import { PhysicalMapCache } from './physicalMapCache.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import type { VisMaterial } from '../../visibility/types.ts'
import { PHYSICAL_MAP_FIELDS } from '../../visibility/materialType.ts'
import { mipLevelCountFor, levelSize } from '../../texture/tiles.ts'
import { mipFiltered } from '../../../../sdk-core/src/texture/contract.ts'
import { samplingWords } from '../../texture/sampling.ts'
import { allocated } from '../core/allocation.ts'
import type { MipChain } from './mips.ts'
import type { Matrix3UniformCache } from './uniforms.ts'
import { physicalMapLayout } from './physicalMapLayout.ts'

export const PHYSICAL_MAP_UNIT = 15
/** Uses the existing texture cache's uploaded mip chains; arrays share identical image tuples across materials.
 * Only an image or sampling change copies texels. UV edits change uniforms alone. */
export class WebglPhysicalMaps {
  private gl: WebGL2RenderingContext
  readonly cache: PhysicalMapCache
  private framebuffer: WebGLFramebuffer | null = null
  private empty: WebGLTexture | null = null
  /** Per-bind uniform scratch, cleared on every bind: `uniform4iv` copies it. */
  private info = new Int32Array(16)
  private channels = new Int32Array(4)
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.cache = new PhysicalMapCache(gl)
  }
  get bytes() {
    return this.cache.bytes + (this.empty ? 4 : 0)
  }
  bind(
    owner: object,
    mat: VisMaterial,
    read: (map: Texture) => MipChain,
    at: (name: string) => WebGLUniformLocation | null,
    matrices: Matrix3UniformCache,
  ) {
    const gl = this.gl
    const maps = PHYSICAL_MAP_FIELDS.map((field) => mat[field])
    const sources = maps.map((map) => (map ? read(map) : undefined))
    const unique = [...new Set(sources.filter((source): source is MipChain => !!source))]
    const layers = Int32Array.from(sources.map((source) => (source ? unique.indexOf(source) : 0)))
    const info = this.info.fill(0)
    const channels = this.channels.fill(0)
    for (let i = 0; i < 4; i++) {
      const map = maps[i],
        source = sources[i]
      if (!map || !source) continue
      info.set(
        [
          source.width,
          source.height,
          mipFiltered(map.minFilter) ? mipLevelCountFor(source.width, source.height) - 1 : 0,
          samplingWords(map, false)[0],
        ],
        i * 4,
      )
      channels[i] = map.channel
      matrices.set(`physicalMapUv[${i}]`, map.transform)
    }
    gl.uniform4iv(at('physicalMapInfo[0]'), info)
    gl.uniform4iv(at('physicalMapChannels'), channels)
    gl.uniform4iv(at('physicalMapLayer'), layers)
    gl.activeTexture(gl.TEXTURE0 + PHYSICAL_MAP_UNIT)
    if (!sources.some(Boolean)) {
      this.cache.release(owner)
      if (!this.empty) {
        this.empty = gl.createTexture()
        const empty = this.empty
        allocated(gl, 'texture', () => {
          if (this.empty === empty) {
            gl.deleteTexture(empty)
            this.empty = null
          }
        })
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.empty)
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      } else gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.empty)
      return
    }
    const key = maps
      .map((map, i) =>
        map
          ? `${map.id}:${map.version}:${map.sampling}:${sources[i]!.width}:${sources[i]!.height}`
          : '-',
      )
      .join('/')
    const held = this.cache.tuples.get(key)
    if (held) {
      this.cache.retain(owner, key)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, held.texture)
      return
    }
    if (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) < unique.length)
      throw new Error('PHYSICAL_MAP_LAYER_LIMIT')
    const layout = physicalMapLayout(
      unique.map((source) => [source.width, source.height]),
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
    )
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    try {
      gl.texStorage3D(
        gl.TEXTURE_2D_ARRAY,
        layout.levels,
        gl.RGBA8,
        layout.width,
        layout.height,
        layout.layers,
      )
      allocated(gl, 'texture', () => {
        if (this.cache.tuples.get(key)?.texture === texture) this.cache.drop(key)
      })
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      this.framebuffer ??= gl.createFramebuffer()
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer)
      gl.readBuffer(gl.COLOR_ATTACHMENT0)
      for (let layer = 0; layer < 4; layer++) {
        const source = sources[layer]
        if (!source || sources.indexOf(source) !== layer) continue
        for (let level = 0; level <= info[layer * 4 + 2]; level++) {
          gl.framebufferTexture2D(
            gl.READ_FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            source.texture,
            level,
          )
          if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('PHYSICAL_MAP_COPY_FRAMEBUFFER')
          const [width, height] = levelSize(source.width, source.height, level)
          gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layers[layer], 0, 0, width, height)
        }
      }
    } catch (error) {
      gl.deleteTexture(texture)
      throw error
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous)
    }
    this.cache.tuples.set(key, {
      texture,
      bytes: layout.bytes,
      sources: maps.filter((map): map is Texture => !!map),
      owners: new Set(),
    })
    this.cache.retain(owner, key)
  }
  dispose() {
    this.cache.dispose()
    this.gl.deleteTexture(this.empty)
    this.gl.deleteFramebuffer(this.framebuffer)
    this.empty = this.framebuffer = null
  }
}
