import type { Texture } from '../texture/texture.ts';
import type { PhysicsMaterialPreset } from '../../physics/options.ts';
import type { ColorInput } from '../math/color.ts';
import type { Blending, Side } from '../constants/index.ts';

/** What a page may pass to a material member; every field is optional. */
export interface MaterialParameters {
  /** The base colour. */
  color?: ColorInput;
  /** A colour the surface gives off by itself, even in the dark. */
  emissive?: ColorInput;
  /** How strongly the surface glows. */
  emissiveIntensity?: number;
  /** How much the surface is metal: 0 is not at all, 1 is fully. */
  metalness?: number;
  /** How rough the surface is: 0 is a mirror, 1 is fully matte. */
  roughness?: number;
  /** How small and bright the shiny spot is. */
  shininess?: number;
  /** How opaque the surface is: 1 hides what is behind, 0 shows it all. */
  opacity?: number;
  /** Whether `opacity` lets what is behind show through. */
  transparent?: boolean;
  /** Which faces are drawn: the front, the back or both. */
  side?: Side;
  /** How the surface mixes with what is behind it. */
  blending?: Blending;
  /** Pixels less opaque than this are not drawn at all: cut-out leaves and fences. */
  alphaTest?: number;
  /** Diffuse transmission through a thin double-sided surface; black disables it. */
  subsurfaceColor?: ColorInput;
  /** Optional linear transmission tint, multiplied by subsurfaceColor. */
  subsurfaceMap?: Texture | null;
  /** How much light passes through, like glass: 0 to 1. */
  transmission?: number;
  /** How much light bends going in: 1.5 for glass, 1.33 for water. */
  ior?: number;
  /** How thick a see-through surface is. */
  thickness?: number;
  /** Declared anisotropy strength, 0 to 1; not rendered yet. */
  anisotropy?: number;
  /** Declared anisotropy direction, in radians; not rendered yet. */
  anisotropyRotation?: number;
  /** A clear varnish on top: 0 to 1. */
  clearcoat?: number;
  /** How rough the varnish is. */
  clearcoatRoughness?: number;
  /** A soft glow at grazing angles, like velvet. */
  sheen?: number;
  /** Rainbow colours that change with the angle, like a soap bubble. */
  iridescence?: number;
  /** Draws only the edges of the triangles. */
  wireframe?: boolean;
  /** Gives each triangle one flat shade, showing its facets. */
  flatShading?: boolean;
  /** Size of a dot, for the points material. */
  size?: number;
  /** Whether dots and sprites get smaller with distance. */
  sizeAttenuation?: boolean;
  /** How far a sprite's picture is turned in the image, in radians, counter-clockwise. */ rotation?: number;
  /** Width of a line in CSS pixels, the same at every distance. */
  linewidth?: number;
  /** Length of a dash, in world units along the line. */
  dashSize?: number;
  /** Length of the gap between two dashes, in world units along the line. */
  gapSize?: number;
  /** How much the distance along a dashed line is stretched: 2 draws dashes and gaps half as long. */
  scale?: number;
  /** Whether the geometry's per-vertex `color` tints the surface. */
  vertexColors?: boolean;
  /** Whether the surface writes its depth, hiding what is drawn after it. */
  depthWrite?: boolean;
  /** Whether the surface hides behind what is already closer. */ depthTest?: boolean;
  /** Whether a see-through (`transparent`) surface still casts a shadow, paler the more see-through it is. @defaultValue false */ transparentShadow?: boolean;
  /** The matter of a body wearing it: density, friction, restitution. */ physics?: PhysicsMaterialPreset;
  /** kg/m³, times the volume for the mass. @defaultValue 1000 */ density?: number;
  /** How much a body grips, 0 and up. @defaultValue 0.5 */ friction?: number;
  /** How much a body bounces, 0 to 1. @defaultValue 0 */ restitution?: number;
  [param: string]: unknown;
}
