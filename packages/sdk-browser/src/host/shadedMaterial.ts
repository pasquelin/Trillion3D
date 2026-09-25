/**
 * The shaded fields of a host material, named by shape.
 *
 * `resources.ts` declares what EVERY host material carries — its version, its raster state,
 * its face constant. What a PBR material adds on top is declared here: the factors, the colours
 * and the map slots the import reads once into the engine's own record, and the extension slots
 * the admission gate refuses before a draw. A host object of the same shape satisfies them; no
 * rendering library is named on either side.
 */

import type { HostColour, HostMaterial, HostTexture } from './resources.ts';

/** A map slot: the texture the material names there, or nothing. */
export type HostMap = HostTexture | null | undefined;

/** A host colour is declared as such by its owner; three loose numbers are not one. */
export const isHostColour = (value: unknown): value is HostColour =>
  !!value && (value as { isColor?: boolean }).isColor === true;

/**
 * A surface as the two surface boundaries read it. Every field is optional: an unlit family
 * declares none of the lit ones, and its `family` says which one it is.
 */
export type HostShadedMaterial = HostMaterial & {
  /** A Phong material's exponent, and a matcap material's image. */
  readonly shininess?: number;
  readonly matcap?: HostMap;
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
  /** Width in CSS pixels of the lines the surface draws; zero when it draws triangles. */
  readonly lineWidth?: number;
  /** A dashed line's dash and gap along the line, in world units; absent on any other surface. */
  readonly dashSize?: number;
  readonly gapSize?: number;
  /** Set on a surface that draws a sprite's quad, with its turn and its size rule. */
  readonly sprite?: boolean;
  readonly rotation?: number;
  readonly sizeAttenuation?: boolean;
  readonly envMap?: HostMap;
  readonly lightMap?: HostMap;
  readonly bumpMap?: HostMap;
  readonly displacementMap?: HostMap;
  readonly alphaMap?: HostMap;
  /** The compile hook a host may install on a material; `surfaceGate.ts` reads only whether
   *  one was installed, never what it does. */
  readonly onBeforeCompile?: unknown;
};
