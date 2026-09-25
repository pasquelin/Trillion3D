/**
 * THE ENGINE'S GRAPH, HANDED TO THE WITNESS RENDERER: the geometries, surfaces and textures of
 * `packages/sdk-browser/src/host/graph/`, copied into the library the witnesses draw with. Each has
 * one copy, made on first request and kept in step with the version the engine bumps; a library
 * object crosses as it is. Every number is the engine's.
 */
import * as THREE from 'three';
import type { VertexAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts';
import type { GraphGeometry } from '../../../packages/sdk-browser/src/host/graph/geometry.ts';
import type { GraphSurface } from '../../../packages/sdk-browser/src/host/graph/surface.ts';
import { isGraphTexture } from '../../../packages/sdk-browser/src/host/graph/kinds.ts';
import type { GraphTexture } from '../../../packages/sdk-browser/src/host/graph/texture.ts';
import type { HostMaterials } from '../../../packages/sdk-browser/src/host/resources.ts';

type Held<T> = { made: T; version: number };
const textures = new WeakMap<GraphTexture, Held<THREE.Texture>>();
const sources = new WeakMap<object, THREE.Source>();
const surfaces = new WeakMap<GraphSurface, Held<THREE.Material>>();
const geometries = new WeakMap<GraphGeometry, THREE.BufferGeometry>();
const attributes = new WeakMap<object, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>();
const buffers = new WeakMap<object, THREE.InterleavedBuffer>();

/** Gives the copy back when the engine gives the original back. */
function follow(original: { released: Set<() => void> }, copy: { dispose(): void }) {
  original.released.add(() => copy.dispose());
}

/** The image of a texture, shared by every copy that samples it: one upload per image. */
function sourceOf(image: unknown) {
  if (typeof image !== 'object' || image === null) return new THREE.Source(image);
  let source = sources.get(image);
  if (!source) sources.set(image, (source = new THREE.Source(image)));
  return source;
}

/** The library's texture of an engine texture, its sampler state and transform kept in step. */
export function threeTexture(texture: GraphTexture | THREE.Texture): THREE.Texture {
  if (texture instanceof THREE.Texture) return texture;
  let held = textures.get(texture);
  if (held && held.version === texture.version) return held.made;
  if (!held) {
    const pixels = texture.image as { data: THREE.TypedArray; width: number; height: number };
    const format = texture.format as THREE.PixelFormat;
    held = {
      made:
        texture.kind === 'texels'
          ? new THREE.DataTexture(pixels.data, pixels.width, pixels.height, format)
          : new THREE.Texture(),
      version: -1,
    };
    textures.set(texture, held);
    follow(texture, held.made);
  }
  const made = held.made;
  // The picture is taken again at every version: a texture whose image was replaced shows it.
  if (texture.kind !== 'texels') {
    if (made.source.data !== texture.image) made.source = sourceOf(texture.image);
  } else if (made.image !== texture.image) made.image = texture.image as typeof made.image;
  made.name = texture.name;
  made.mapping = texture.mapping as THREE.Mapping;
  made.channel = texture.channel;
  made.wrapS = texture.wrapS as THREE.Wrapping;
  made.wrapT = texture.wrapT as THREE.Wrapping;
  made.magFilter = texture.magFilter as THREE.MagnificationTextureFilter;
  made.minFilter = texture.minFilter as THREE.MinificationTextureFilter;
  made.anisotropy = texture.anisotropy;
  made.colorSpace = texture.colorSpace as THREE.ColorSpace;
  made.offset.set(texture.offset.x, texture.offset.y);
  made.repeat.set(texture.repeat.x, texture.repeat.y);
  made.center.set(texture.center.x, texture.center.y);
  made.rotation = texture.rotation;
  made.matrixAutoUpdate = texture.matrixAutoUpdate;
  made.matrix.fromArray(texture.matrix.elements);
  made.generateMipmaps = texture.generateMipmaps;
  made.premultiplyAlpha = texture.premultiplyAlpha;
  made.flipY = texture.flipY;
  made.needsUpdate = true;
  held.version = texture.version;
  return made;
}

/** The family each engine surface is drawn as. */
const FAMILIES: Record<GraphSurface['family'], new () => THREE.Material> = {
  basic: THREE.MeshBasicMaterial,
  standard: THREE.MeshStandardMaterial,
  physical: THREE.MeshPhysicalMaterial,
  lambert: THREE.MeshLambertMaterial,
  phong: THREE.MeshPhongMaterial,
  toon: THREE.MeshToonMaterial,
  normal: THREE.MeshNormalMaterial,
  matcap: THREE.MeshMatcapMaterial,
  depth: THREE.MeshDepthMaterial,
};
/** Fields of an engine surface that are its identity or its bookkeeping, never a parameter. */
const BOOKKEEPING = new Set(['uuid', 'version', 'released', 'type', 'family', 'userData']);
/** A brand the family carries itself: `isMeshStandardMaterial`… */
const BRAND = /^is[A-Z]/;

/** Writes the engine surface's parameters into the library's, as its constructor would. */
function paint(into: THREE.Material, surface: GraphSurface) {
  const target = into as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(surface)) {
    if (BOOKKEEPING.has(key) || BRAND.test(key) || !(key in into)) continue;
    const held = target[key] as { isColor?: boolean; isVector2?: boolean } | null;
    const given = value as Record<'r' | 'g' | 'b' | 'x' | 'y', number>;
    if (isGraphTexture(value)) target[key] = threeTexture(value);
    else if (held?.isColor && value) (held as THREE.Color).setRGB(given.r, given.g, given.b);
    else if (held?.isVector2 && value) (held as THREE.Vector2).set(given.x, given.y);
    else target[key] = Array.isArray(value) ? value.slice() : value;
  }
}

/** The library's surface of an engine surface, kept in step with its version. */
function threeMaterial(surface: GraphSurface | THREE.Material): THREE.Material {
  if (surface instanceof THREE.Material) return surface;
  let held = surfaces.get(surface);
  if (!held) {
    held = { made: new FAMILIES[surface.family](), version: -1 };
    surfaces.set(surface, held);
    follow(surface, held.made);
  }
  // Painted at every request: a texture it samples may have changed without the surface.
  paint(held.made, surface);
  if (held.version >= 0 && held.version !== surface.version) held.made.needsUpdate = true;
  held.version = surface.version;
  return held.made;
}

/** One surface or one per geometry group, each handed to the library. */
export function threeMaterials(declared: HostMaterials | THREE.Material | THREE.Material[]) {
  const surfaces = declared as unknown as GraphSurface | GraphSurface[];
  return Array.isArray(surfaces) ? surfaces.map(threeMaterial) : threeMaterial(surfaces);
}

/** The library's attribute of an engine one, sharing its storage. */
function threeAttribute(attribute: VertexAttribute) {
  let made = attributes.get(attribute);
  if (made) return made;
  if (!('data' in attribute))
    made = new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized);
  else {
    const data = attribute.data;
    let buffer = buffers.get(data);
    if (!buffer) buffers.set(data, (buffer = new THREE.InterleavedBuffer(data.array, data.stride)));
    made = new THREE.InterleavedBufferAttribute(
      buffer,
      attribute.itemSize,
      attribute.offset,
      attribute.normalized,
    );
  }
  made.name = attribute.name;
  attributes.set(attribute, made);
  return made;
}

/** The library's geometry of an engine geometry: the same storage, index, targets and bounds. */
export function threeGeometry(
  geometry: GraphGeometry | THREE.BufferGeometry,
): THREE.BufferGeometry {
  if (geometry instanceof THREE.BufferGeometry) return geometry;
  let made = geometries.get(geometry);
  if (made) return made;
  made = new THREE.BufferGeometry();
  made.name = geometry.name;
  for (const [name, attribute] of Object.entries(geometry.attributes))
    made.setAttribute(name, threeAttribute(attribute));
  if (geometry.index) made.setIndex(threeAttribute(geometry.index) as THREE.BufferAttribute);
  for (const [name, targets] of Object.entries(geometry.morphAttributes))
    made.morphAttributes[name] = targets.map(threeAttribute) as THREE.BufferAttribute[];
  made.morphTargetsRelative = geometry.morphTargetsRelative;
  for (const group of geometry.groups) made.addGroup(group.start, group.count, group.materialIndex);
  made.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
  const box = geometry.boundingBox,
    sphere = geometry.boundingSphere;
  if (box)
    made.boundingBox = new THREE.Box3(
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    );
  if (sphere)
    made.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(sphere.center.x, sphere.center.y, sphere.center.z),
      sphere.radius,
    );
  geometries.set(geometry, made);
  follow(geometry, made);
  return made;
}
