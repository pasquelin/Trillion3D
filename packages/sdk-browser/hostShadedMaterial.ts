/**
 * The shaded fields of a host material, named by shape.
 *
 * `hostResources.ts` declares what EVERY host material carries — its version, its raster state,
 * its face constant. What a PBR material adds on top is declared here: the factors, the colours
 * and the map slots the import reads once into the engine's own record, and the extension slots
 * the admission gate refuses before a draw. A host object of the same shape satisfies them; no
 * rendering library is named on either side.
 */

import type { HostColour, HostMaterial, HostTexture } from './hostResources.ts';

/** A map slot: the texture the material names there, or nothing. */
export type HostMap = HostTexture | null | undefined;

/** A host colour is declared as such by its owner; three loose numbers are not one. */
export const isHostColour = (value: unknown): value is HostColour =>
  !!value && (value as { isColor?: boolean }).isColor === true;

/**
 * A host material as the two surface boundaries read it. Every field is optional: an unlit
 * material declares none of the lit ones, and the flags the host raises — `isMeshBasicMaterial`,
 * `isMeshStandardMaterial`, `isMeshPhysicalMaterial` — are what says which family this is.
 */
export type HostShadedMaterial = HostMaterial & {
  /** The name the host gives the material family, quoted back in an admission refusal. */
  readonly type?: string;
  readonly isMeshBasicMaterial?: boolean;
  readonly isMeshStandardMaterial?: boolean;
  readonly isMeshPhysicalMaterial?: boolean;
  readonly color?: unknown;
  readonly map?: HostMap;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly metalnessMap?: HostMap;
  readonly roughnessMap?: HostMap;
  readonly normalMap?: HostMap;
  readonly normalMapType?: number;
  readonly normalScale?: { readonly x: number; readonly y: number };
  readonly aoMap?: HostMap;
  readonly aoMapIntensity?: number;
  readonly emissive?: unknown;
  readonly emissiveIntensity?: number;
  readonly emissiveMap?: HostMap;
  /** glTF transmission volume: the one physical extension the engine keeps. */
  readonly transmission?: number;
  readonly ior?: number;
  readonly thickness?: number;
  readonly attenuationDistance?: number;
  readonly attenuationColor?: unknown;
  /** Blend and raster state the gate refuses when the autonomous programs cannot preserve it. */
  readonly alphaHash?: boolean;
  readonly blending?: number;
  readonly premultipliedAlpha?: boolean;
  readonly alphaToCoverage?: boolean;
  readonly clippingPlanes?: { readonly length: number } | null;
  readonly stencilWrite?: boolean;
  readonly flatShading?: boolean;
  readonly wireframe?: boolean;
  readonly envMap?: HostMap;
  readonly lightMap?: HostMap;
  readonly bumpMap?: HostMap;
  readonly displacementMap?: HostMap;
  readonly alphaMap?: HostMap;
  /** The compile hook a host may install on a material; `hostSurfaceGate.ts` reads only whether
   *  one was installed, never what it does. */
  readonly onBeforeCompile?: unknown;
};

/** A host texture as the gate reads it: the sampler state, plus the storage the host declares
 *  it in — a compressed, raw or array storage the engine has no path for. */
export type HostStoredTexture = HostTexture & {
  readonly isCompressedTexture?: boolean;
  readonly isDataTexture?: boolean;
  readonly isDataArrayTexture?: boolean;
  readonly mapping?: number;
};
