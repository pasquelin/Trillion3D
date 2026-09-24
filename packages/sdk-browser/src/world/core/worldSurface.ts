/**
 * THE HOST SURFACE OF A WORLD'S MATERIAL: the family its kind names, built with the host library.
 *
 * A physical kind is the engine's own record (`Material.surface`, `hostPageSurface`), on a
 * physical surface when it declares a physical field. Every other kind is the host family of the
 * same name — basic, Lambert, Phong, toon, normal, matcap, depth —, which the host renderer
 * draws as it is on the WebGL2 path and which the engine maps onto its one lighting model on the
 * WebGPU one (`surfaceModel.ts`). Lines, points and sprites are unlit: they wear a basic surface.
 */
import * as THREE from 'three';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { hostPageSurface } from '../../host/pageObjects.ts';
import { asHostLibrary } from '../../host/resources.ts';
import { hostSide } from '../../scene/materialSide.ts';
import {
  COLOUR_MAPS,
  HOST_MAPS,
  hostTexture,
  repaintHostMaps,
  type HostTextures,
} from './worldTextures.ts';

/** Physically based fields beyond the engine record, carried on a physical host surface. */
const PHYSICAL = [
  'transmission',
  'ior',
  'thickness',
  'clearcoat',
  'clearcoatRoughness',
  'sheen',
  'iridescence',
];

/** The host family of each kind that is not physical. */
const FAMILY: Record<string, new () => THREE.Material> = {
  meshBasic: THREE.MeshBasicMaterial,
  line: THREE.MeshBasicMaterial,
  lineDashed: THREE.MeshBasicMaterial,
  points: THREE.MeshBasicMaterial,
  sprite: THREE.MeshBasicMaterial,
  shadow: THREE.MeshBasicMaterial,
  meshLambert: THREE.MeshLambertMaterial,
  meshPhong: THREE.MeshPhongMaterial,
  meshToon: THREE.MeshToonMaterial,
  meshNormal: THREE.MeshNormalMaterial,
  meshMatcap: THREE.MeshMatcapMaterial,
  meshDepth: THREE.MeshDepthMaterial,
};
/** Colours a family may carry, written in the linear working space both sides share. */
const COLOURS = ['color', 'emissive', 'specular'];

/** The physical surface: the engine's record, plus the physical fields it does not carry. */
function physicalSurface(material: Material, vertexColors: boolean) {
  let surface = asHostLibrary<THREE.MeshStandardMaterial>(
    hostPageSurface(material.surface(), vertexColors),
  );
  if (PHYSICAL.some((field) => typeof material[field] === 'number' && material[field] !== 0)) {
    const physical = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(physical, surface);
    for (const field of PHYSICAL)
      if (typeof material[field] === 'number')
        Object.assign(physical, { [field]: material[field] });
    surface.dispose();
    surface = physical;
  }
  return surface;
}

/** A non-physical family, its fields written from the material's where the family has them. */
function familySurface(
  Family: new () => THREE.Material,
  material: Material,
  vertexColors: boolean,
) {
  const surface = new Family() as THREE.Material & Record<string, unknown>;
  for (const field of COLOURS) {
    const colour = material[field] as { r: number; g: number; b: number } | undefined;
    const into = surface[field] as THREE.Color | undefined;
    if (colour && into?.isColor) into.setRGB(colour.r, colour.g, colour.b);
  }
  if ((surface.emissive as THREE.Color | undefined)?.isColor)
    (surface.emissive as THREE.Color).multiplyScalar(material.emissiveIntensity);
  if (typeof material.shininess === 'number' && 'shininess' in surface)
    surface.shininess = material.shininess;
  surface.opacity = material.opacity;
  surface.transparent = material.transparent;
  surface.alphaTest = material.alphaTest;
  surface.side = asHostLibrary<THREE.Side>(hostSide(material.side));
  surface.vertexColors = vertexColors;
  return surface;
}

/** The host surface of a world material, with its maps and raster state. */
export function hostSurface(material: Material, vertexColors: boolean, textures: HostTextures) {
  const Family = FAMILY[material.kind];
  const surface = (
    Family ? familySurface(Family, material, vertexColors) : physicalSurface(material, vertexColors)
  ) as THREE.Material & Record<string, unknown>;
  for (const field of HOST_MAPS) {
    const texture = material[field] as Texture | undefined;
    if (texture?.isTexture && field in surface)
      surface[field] = hostTexture(texture, COLOUR_MAPS.has(field), textures);
  }
  if ('flatShading' in surface) surface.flatShading = material.flatShading === true;
  surface.depthWrite = material.depthWrite;
  surface.depthTest = material.depthTest;
  return surface;
}

/**
 * Writes a material's value fields — colour, glow, metalness, roughness — and its maps' sampling
 * into the host surface built for it, as `hostSurface` wrote them, and bumps the surface's
 * version: every reader of the surface (`page/surface.ts`) takes them at its next read, nothing
 * built again (#335). A map that shows another picture keeps the one it was uploaded with
 * (`repaintHostMaps`).
 */
export function repaintHostSurface(surface: THREE.Material, material: Material) {
  const into = surface as THREE.Material & Record<string, unknown>;
  repaintHostMaps(into, material);
  const { color, emissive } = material;
  (into.color as THREE.Color | undefined)?.setRGB(color.r, color.g, color.b);
  (into.emissive as THREE.Color | undefined)
    ?.setRGB(emissive.r, emissive.g, emissive.b)
    .multiplyScalar(material.emissiveIntensity);
  if (typeof into.metalness === 'number') into.metalness = material.metalness;
  if (typeof into.roughness === 'number') into.roughness = material.roughness;
  surface.needsUpdate = true;
}
