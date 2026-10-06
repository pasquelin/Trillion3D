import type { GpuBuffer, WholeMesh } from '../../cluster/batchMesh.ts'
import { glType, upload, type CachedAttribute } from './buffers.ts'
import { WebglClusterPlacements } from './placements.ts'
import { WebglPageArenas } from './pageArenas.ts'

/** What the cache binds: a batch record's geometry, or that of a host mesh drawn whole. */
type Geometry = WholeMesh['geometry']

type CachedGeometry = {
  vao: WebGLVertexArrayObject
  index?: CachedAttribute
  attributes: Map<string, CachedAttribute>
  /** The placements the vertex array reads, `null` for a mesh drawn once. */
  instances: GpuBuffer | null
  /** Frees this entry when its geometry is given back; removed at the renderer's dispose. */
  release?: () => void
  /** The frame its arrays were last checked against the geometry's versions. */
  checked?: number
}
/** A geometry of the engine's own graph announces its release; a host one never does. */
type Releasing = { released?: Set<() => void> }
/** The attributes the program reads, by name: a skinned page's joints and weights last (#357). */
const SKIN = ['skinIndex', 'skinWeight'] as const
export const ATTRIBUTES = ['position', 'normal', 'uv', 'uv1', 'color', ...SKIN] as const
/** An attribute the program can bind: one owning its buffer; an interleaved view reads as absent. */
export const drawnAttribute = (geometry: Geometry, name: string) => {
  const attribute = geometry.attributes[name]
  return attribute?.kind === 'attribute' ? attribute : undefined
}

export class WebglClusterGeometry {
  private cache = new Map<Geometry, CachedGeometry>()
  private gl: WebGL2RenderingContext
  private locations: Record<string, number>
  /** The placement matrices of the instanced meshes, one buffer each, freed with their mesh. */
  private placements: WebglClusterPlacements
  /** The shared buffers the pages are drawn from, by vertex layout (`pageArenas.ts`). */
  readonly arenas: WebglPageArenas
  constructor(gl: WebGL2RenderingContext, locations: Record<string, number>) {
    this.gl = gl
    this.locations = locations
    this.placements = new WebglClusterPlacements(gl, locations.instanceMatrix)
    this.arenas = new WebglPageArenas(gl, locations)
  }
  /** Binds an arena's vertex array (`pageArena.ts`), whose absent attributes read the frame's
   *  constants. */
  bindArena(vao: WebGLVertexArrayObject) {
    this.gl.bindVertexArray(vao)
    if (!this.generics) this.setGenerics()
  }
  /** Binds `geometry`, and the placement matrices of `mesh`, an instanced mesh. */
  bind(geometry: Geometry, mesh?: Pick<WholeMesh, 'instanceMatrix' | 'released'>) {
    const gl = this.gl
    let cached = this.cache.get(geometry)
    if (!cached) {
      const index = geometry.index
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      cached = {
        vao,
        index: index ? upload(gl, gl.ELEMENT_ARRAY_BUFFER, index) : undefined,
        attributes: new Map(),
        instances: null,
      }
      if (cached.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cached.index.buffer)
      this.cache.set(geometry, cached)
      const released = (geometry as Releasing).released
      if (released) {
        const entry = cached
        entry.release = () => {
          this.cache.delete(geometry)
          this.free(entry)
        }
        released.add(entry.release)
      }
    }
    gl.bindVertexArray(cached.vao)
    // The vertex array holds its buffers and pointers: they are specified again only when an
    // attribute was replaced or rewritten since, read once a frame — the frame's passes draw the
    // same geometry (#840). The constant of an absent attribute is context state, not the
    // array's, and is set once per frame.
    if (cached.checked !== this.frame && !this.current(cached, geometry))
      this.specify(cached, geometry)
    cached.checked = this.frame
    if (!this.generics) this.setGenerics()
    cached.instances = this.placements.bind(cached.instances, mesh)
  }
  /** Whether the vertex array still describes `geometry`: the same index and attributes, at the
   *  versions it uploaded. */
  private current(cached: CachedGeometry, geometry: Geometry) {
    const index = geometry.index
    if (index && (cached.index?.source !== index || cached.index.version !== index.version))
      return false
    for (const name of ATTRIBUTES) {
      if (this.locations[name] < 0) continue
      const attribute = drawnAttribute(geometry, name),
        entry = cached.attributes.get(name)
      if (attribute ? entry?.source !== attribute || entry.version !== attribute.version : entry)
        return false
    }
    return true
  }
  /** Uploads what changed and points the vertex array at it; an absent attribute is disabled. */
  private specify(cached: CachedGeometry, geometry: Geometry) {
    const gl = this.gl
    if (geometry.index) {
      cached.index = upload(gl, gl.ELEMENT_ARRAY_BUFFER, geometry.index, cached.index)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cached.index.buffer)
    }
    for (const name of ATTRIBUTES) {
      const attribute = drawnAttribute(geometry, name),
        location = this.locations[name]
      if (location < 0) continue
      const held = cached.attributes.get(name)
      if (held && held.source !== attribute) this.drop(held)
      if (!attribute) {
        gl.disableVertexAttribArray(location)
        cached.attributes.delete(name)
        continue
      }
      const entry = upload(gl, gl.ARRAY_BUFFER, attribute, this.shared(attribute))
      if (held?.source !== attribute) this.lists.get(attribute)!.users++
      cached.attributes.set(name, entry)
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(
        location,
        attribute.itemSize,
        glType(gl, attribute.array),
        attribute.normalized,
        0,
        0,
      )
    }
  }
  /** Whether the constants of absent attributes were set this frame. */
  private generics = false
  /** The frame drawn, counted by `beginFrame`. */
  private frame = 0
  /** A new frame: the context's constants may have been written by another program since, and
   *  the geometries rewritten. */
  beginFrame() {
    this.generics = false
    this.frame++
    this.arenas.beginFrame()
  }
  /** White for an absent colour, zero for any other absent attribute. */
  private setGenerics() {
    const gl = this.gl
    for (const name of ATTRIBUTES) {
      const location = this.locations[name]
      if (location < 0) continue
      if (name === 'color') gl.vertexAttrib4f(location, 1, 1, 1, 1)
      else gl.vertexAttrib2f(location, 0, 0)
    }
    this.generics = true
  }
  /**
   * One buffer per vertex list, whatever number of geometries read it — the pages of a dynamic
   * geometry all read its lists (#573) —: uploaded once per version, by its written ranges alone
   * (`upload`), and freed with its last reader.
   */
  private lists = new Map<GpuBuffer, CachedAttribute & { users: number }>()
  private shared(attribute: GpuBuffer) {
    let entry = this.lists.get(attribute)
    if (!entry) {
      const buffer = this.gl.createBuffer()!
      this.lists.set(
        attribute,
        (entry = { buffer, source: attribute, version: -1, bytes: 0, users: 0 }),
      )
    }
    return entry
  }
  private drop(entry: CachedAttribute) {
    const shared = this.lists.get(entry.source)
    if (shared !== entry || --shared.users > 0) return
    this.lists.delete(entry.source)
    this.gl.deleteBuffer(entry.buffer)
  }
  private free(entry: CachedGeometry) {
    this.gl.deleteVertexArray(entry.vao)
    if (entry.index) this.gl.deleteBuffer(entry.index.buffer)
    for (const attribute of entry.attributes.values()) this.drop(attribute)
  }
  dispose() {
    for (const [geometry, entry] of this.cache) {
      this.free(entry)
      if (entry.release) (geometry as Releasing).released?.delete(entry.release)
    }
    this.cache.clear()
    this.placements.dispose()
    this.arenas.dispose()
  }
}
