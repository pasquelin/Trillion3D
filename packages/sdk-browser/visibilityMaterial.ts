import type { HostMaterials } from './hostResources.ts';
import { importHostSurface } from './hostSurfaceImport.ts';
import type { VisMaterial } from './visibilityTypes.ts';

const WHITE: [number, number, number] = [1, 1, 1];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Engine defaults for an empty material declaration (`material: []`): white, opaque, front, unlit.
 * Shared across empty declarations so per-frame readers avoid allocating on the main path.
 */
const DEFAULT_VIS_MATERIAL: VisMaterial = Object.freeze({
  baseColor: WHITE,
  metalness: 0,
  roughness: 1,
  lit: false,
  doubleSided: false,
  backSide: false,
  alphaTest: 0,
  normalScale: 1,
  normalScaleY: 1,
  aoIntensity: 1,
  emissive: BLACK,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: 0,
  attenuationColor: WHITE,
});

/**
 * Surface parameters of a declaration, as the engine holds them: colours, factors and the engine's
 * own `Texture` records. Reading the host object happens at the boundary
 * (`hostSurfaceImport.ts`); everything downstream computes on what comes back from here.
 */
export function visMaterial(material: HostMaterials): VisMaterial {
  return importHostSurface(material) ?? DEFAULT_VIS_MATERIAL;
}

/** Transmission/volume cannot be reconstructed from a visbuffer ID; keep the source mesh on the
 *  forward path. Read on the imported record: this runs per copy and per frame. */
export function isTransmissive(material: HostMaterials) {
  return visMaterial(material).transmission > 0;
}
