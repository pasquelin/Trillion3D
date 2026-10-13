/**
 * THE ENGINE'S GRAPH, HANDED TO THE WITNESS RENDERER: the geometries and textures a scene of the
 * engine's own graph holds, copied into the library the witnesses draw with (its surfaces cross in
 * `fromSurface.ts`). Each has one copy, made on first request and kept in step with the version the
 * engine bumps; a library object crosses as it is. Every number is the engine's.
 */
import * as THREE from 'three'
import type { VertexAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import type { Texture } from '../../../packages/sdk-core/src/world/texture/texture.ts'
import type { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts'

type Held<T> = { made: T; version: number }
/** One copy per record and reading: a texture worn as colour and as data is decoded twice. */
const textures = [false, true].map(() => new WeakMap<Texture, Held<THREE.Texture>>())
const sources = new WeakMap<object, THREE.Source>()
const geometries = new WeakMap<Geometry, THREE.BufferGeometry>()
const attributes = new WeakMap<object, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>()
const buffers = new WeakMap<object, THREE.InterleavedBuffer>()

/** Gives the copy back when the engine gives the original back. */
export function follow(original: { released: Set<() => void> }, copy: { dispose(): void }) {
  original.released.add(() => copy.dispose())
}

/** The image of a texture, shared by every copy that samples it: one upload per image. */
function sourceOf(image: unknown) {
  if (typeof image !== 'object' || image === null) return new THREE.Source(image)
  let source = sources.get(image)
  if (!source) sources.set(image, (source = new THREE.Source(image)))
  return source
}

/** The engine's words in the library's numbers: addressing, filtering, texel channels. */
const WRAPS = {
  repeat: THREE.RepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
} as const
const FILTERS = {
  nearest: THREE.NearestFilter,
  linear: THREE.LinearFilter,
  nearestMipNearest: THREE.NearestMipmapNearestFilter,
  nearestMipLinear: THREE.NearestMipmapLinearFilter,
  linearMipNearest: THREE.LinearMipmapNearestFilter,
  linearMipLinear: THREE.LinearMipmapLinearFilter,
} as const
const FORMATS: Record<string, THREE.PixelFormat> = {
  rgba: THREE.RGBAFormat,
  rgb: THREE.RGBFormat as THREE.PixelFormat,
  r: THREE.RedFormat,
}

/** The library's texture of an engine texture record, its sampler state and transform kept in
 *  step with the record's three counters; decoded as sRGB only where a colour field wears an sRGB
 *  record, as the engine's colour atlas reads it. */
export function threeTexture(texture: Texture | THREE.Texture, colour: boolean): THREE.Texture {
  if (texture instanceof THREE.Texture) return texture
  const version = texture.version + texture.sampling + texture.placement
  const copies = textures[+colour]
  let held = copies.get(texture)
  if (held && held.version === version) return held.made
  const texels = texture.layout === 'data'
  if (!held) {
    const pixels = texture.image as { data: THREE.TypedArray; width: number; height: number }
    held = {
      made: texels
        ? new THREE.DataTexture(pixels.data, pixels.width, pixels.height, FORMATS[texture.format])
        : new THREE.Texture(),
      version: -1,
    }
    copies.set(texture, held)
  }
  const made = held.made
  // The picture is taken again at every version: a texture whose image was replaced shows it.
  if (!texels) {
    if (made.source.data !== texture.image) made.source = sourceOf(texture.image)
  } else if (made.image !== texture.image) made.image = texture.image as typeof made.image
  made.name = texture.name
  made.channel = texture.channel
  made.wrapS = WRAPS[texture.wrapS]
  made.wrapT = WRAPS[texture.wrapT]
  made.magFilter = FILTERS[texture.magFilter] as THREE.MagnificationTextureFilter
  made.minFilter = FILTERS[texture.minFilter]
  made.anisotropy = texture.anisotropy
  made.colorSpace =
    colour && texture.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  // The record's own composed transform: the library composes nothing of its own.
  made.matrixAutoUpdate = false
  made.matrix.fromArray(texture.transform)
  made.premultiplyAlpha = texture.premultiplyAlpha
  made.flipY = texture.flipY
  made.needsUpdate = true
  held.version = version
  return made
}

/** The library's attribute of an engine one, sharing its storage. */
function threeAttribute(attribute: VertexAttribute) {
  let made = attributes.get(attribute)
  if (made) return made
  if (!('data' in attribute))
    made = new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized)
  else {
    const data = attribute.data
    let buffer = buffers.get(data)
    if (!buffer) buffers.set(data, (buffer = new THREE.InterleavedBuffer(data.array, data.stride)))
    made = new THREE.InterleavedBufferAttribute(
      buffer,
      attribute.itemSize,
      attribute.offset,
      attribute.normalized,
    )
  }
  made.name = attribute.name
  attributes.set(attribute, made)
  return made
}

/** The library's geometry of an engine geometry: the same storage, index, targets and bounds. */
export function threeGeometry(geometry: Geometry | THREE.BufferGeometry): THREE.BufferGeometry {
  if (geometry instanceof THREE.BufferGeometry) return geometry
  let made = geometries.get(geometry)
  if (made) return made
  made = new THREE.BufferGeometry()
  made.name = geometry.name
  for (const [name, attribute] of Object.entries(geometry.attributes))
    made.setAttribute(name, threeAttribute(attribute))
  if (geometry.index) made.setIndex(threeAttribute(geometry.index) as THREE.BufferAttribute)
  for (const [name, targets] of Object.entries(geometry.morphAttributes))
    made.morphAttributes[name] = targets.map(threeAttribute) as THREE.BufferAttribute[]
  made.morphTargetsRelative = geometry.morphTargetsRelative
  for (const group of geometry.groups) made.addGroup(group.start, group.count, group.materialIndex)
  made.setDrawRange(geometry.drawRange.start, geometry.drawRange.count)
  const box = geometry.boundingBox,
    sphere = geometry.boundingSphere
  if (box)
    made.boundingBox = new THREE.Box3(
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    )
  if (sphere)
    made.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(sphere.center.x, sphere.center.y, sphere.center.z),
      sphere.radius,
    )
  geometries.set(geometry, made)
  follow(geometry, made)
  return made
}
