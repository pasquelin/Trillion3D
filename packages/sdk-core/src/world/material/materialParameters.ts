import type { Texture } from '../texture/texture.ts'
import type { MaterialShadingModel } from './shadingModel.ts'
import type { SubsurfaceProfileInput } from '../../lighting/subsurfaceProfile/profile.ts'
import type { MaterialGraph } from './graph/api.ts'
import type { GraphData } from './graph/graph.ts'
import type { PhysicsMaterialPreset } from '../../physics/options.ts'
import type { ColorInput } from '../math/color.ts'
import type { Blending, Side, TranslucencyLighting, TranslucencyPass } from '../constants/index.ts'

/** What a page may pass to a material member; every field is optional. */
export interface MaterialParameters {
  /** A graph wired into the material's outputs (`material.graph(domain)`) or its saved data; its
   *  domain must be the material's. */
  graph?: MaterialGraph | GraphData
  /** The base colour. */
  color?: ColorInput
  /** A colour the surface gives off by itself, even in the dark. */
  emissive?: ColorInput
  /** How strongly the surface glows. */
  emissiveIntensity?: number
  /** A volume material's albedo: the share of the light each channel scatters (`material.volume`). */
  albedo?: ColorInput
  /** A volume material's extinction: the fraction of light a metre of it takes away. */
  extinction?: number
  /** A volume material that gives only its emissive light, no scattering. */
  emissiveOnly?: boolean
  /** How much the surface is metal: 0 is not at all, 1 is fully. */
  metalness?: number
  /** How rough the surface is: 0 is a mirror, 1 is fully matte. */
  roughness?: number
  /** How small and bright the shiny spot is. */
  shininess?: number
  /** How opaque the surface is: 1 hides what is behind, 0 shows it all. */
  opacity?: number
  /** Whether `opacity` lets what is behind show through. */
  transparent?: boolean
  /** Which faces are drawn: the front, the back or both. */
  side?: Side
  /** How the surface mixes with what is behind it. */
  blending?: Blending
  /** Pixels less opaque than this are not drawn at all: cut-out leaves and fences. */
  alphaTest?: number
  /** Diffuse transmission through a thin double-sided surface; black disables it. */
  subsurfaceColor?: ColorInput
  /** Optional linear transmission tint, multiplied by subsurfaceColor. */
  subsurfaceMap?: Texture | null
  /** The shading model of the surface: `defaultLit` (the default), `unlit`, `subsurface`, `preintegratedSkin`, `clearCoat`, `subsurfaceProfile`,
   *  `twoSidedFoliage`, `hair`, `cloth`, `eye`, `singleLayerWater`, `thinTranslucent`, or `fromMaterialExpression`, where the `shadingModel` output
   *  of the material's graph decides each pixel's. Without a graph, `preintegratedSkin` (lit by `subsurfaceColor` and `subsurfaceOpacity`),
   *  `subsurfaceProfile` (`subsurfaceProfile`, `subsurfaceOpacity`) and `eye` (`irisMask`) light their pixels as the model; `clearCoat` and `cloth` are
   *  the `clearcoat` and `sheen` parameters, `subsurface` and `twoSidedFoliage` the `subsurfaceColor` of a double-sided surface. A graph that wires
   *  the `shadingModel` output decides for its material as `fromMaterialExpression` does. */
  shadingModel?: MaterialShadingModel
  /** How opaque the subsurface of a `preintegratedSkin` or `subsurfaceProfile` surface is, 0 to 1 (the profile's scattering needs it above 0.1). @defaultValue 1 */
  subsurfaceOpacity?: number
  /** The share of an `eye` surface that is iris, 0 (sclera) to 1. @defaultValue 1 */
  irisMask?: number
  /** How far the iris is from the sclera of an `eye` surface, 0 to 1: the caustic's concavity (the reference's iris distance pin). @defaultValue 0.1 */
  irisDistance?: number
  /** The subsurface profile of the pixels of its graph's subsurface-profile and eye shading models: how the light scatters under the surface
   *  (see `SubsurfaceProfile`: `scatterRadius`, `subsurfaceColor`, `falloffColor`, `boundaryColorBleed`, `extinctionScale`,
   *  `scatteringDistribution`, `normalScale`, `ior`, `roughness0`, `roughness1`, `lobeMix`, `surfaceAlbedo`, `meanFreePathColor`,
   *  `meanFreePathDistance`, `worldUnitScale`, `tint`, `transmissionTintColor`, `distanceScale`, `burley`, `meanFreePath`,
   *  `implementation`); the fields it leaves out are the default skin's. @defaultValue the default skin's */
  subsurfaceProfile?: SubsurfaceProfileInput | null
  /** How much light passes through, like glass: 0 to 1. */
  transmission?: number
  /** How much light bends going in: 1.5 for glass, 1.33 for water. */
  ior?: number
  /** How thick a see-through surface is, in the mesh's own units: a scaled placement scales it. */
  thickness?: number
  /** Declared anisotropy strength, 0 to 1; not rendered yet. */
  anisotropy?: number
  /** Declared anisotropy direction, in radians; not rendered yet. */
  anisotropyRotation?: number
  /** A clear varnish on top: 0 to 1. */
  clearcoat?: number
  /** How rough the varnish is. */
  clearcoatRoughness?: number
  /** Switches the cloth shading model on above 0, like velvet or woven fabric: the specular lobe turns toward a soft fuzz (`sheenColor`) by the cloth amount (`sheenRoughness`), and the fuzz joins the diffuse colour of the indirect light. A clear coat or a transmission takes the surface first and leaves no cloth; the cloth model has no anisotropy. @defaultValue 0 */
  sheen?: number
  /** The colour of the cloth's fuzz. @defaultValue black */
  sheenColor?: ColorInput
  /** The cloth amount, 0 (the standard specular lobe) to 1 (the fuzz lobe alone): the cloth model needs it above 0 to show. @defaultValue 0 */
  sheenRoughness?: number
  /** Multiplies the fuzz colour by an sRGB image. */
  sheenColorMap?: Texture | null
  /** Multiplies the cloth amount by the alpha channel of an image. */
  sheenRoughnessMap?: Texture | null
  /** The specular input of the surface's dielectric, 0 to 1: its reflectance at normal incidence is 0.08 of it, so 0.5 (the value of a surface that declares none) gives the usual 4%, 1 gives 8% and 0 no highlight. A glTF material's `KHR_materials_specular` factor is written as it is declared. Metal ignores it. @defaultValue undeclared, 0.5 */
  specularIntensity?: number
  /** Multiplies `specularIntensity` by the alpha channel of an image. */
  specularIntensityMap?: Texture | null
  /** Declared rainbow colours that change with the angle, like a soap bubble; not drawn, the engine has no thin-film model. */
  iridescence?: number
  /** Draws only the edges of the triangles. */
  wireframe?: boolean
  /** Gives each triangle one flat shade, showing its facets. */
  flatShading?: boolean
  /** Size of a dot, for the points material. */
  size?: number
  /** Whether dots and sprites get smaller with distance. */
  sizeAttenuation?: boolean
  /** How far a sprite's picture is turned in the image, in radians, counter-clockwise. */ rotation?: number
  /** Width of a line in CSS pixels, the same at every distance. */
  linewidth?: number
  /** Length of a dash, in world units along the line. */
  dashSize?: number
  /** Length of the gap between two dashes, in world units along the line. */
  gapSize?: number
  /** How much the distance along a dashed line is stretched: 2 draws dashes and gaps half as long. */
  scale?: number
  /** Whether the geometry's per-vertex `color` tints the surface. */
  vertexColors?: boolean
  /** Whether the surface writes its depth, hiding what is drawn after it. */
  depthWrite?: boolean
  /** Whether the surface hides behind what is already closer. */ depthTest?: boolean
  /** Whether the `emissive` output of the material's graph may be negative, taking light away: by default it is held at zero, as the other outputs are held to their range. @defaultValue false */ allowNegativeEmissive?: boolean
  /** The value the `opacityMask` output of the material's graph must reach for a pixel to be drawn (the pixel is kept where the output is not below it). Left out, the material's own `alphaTest` where above 0 (a glTF material keeps its `alphaCutoff`), else 0.3333. @defaultValue 0.3333 */ opacityMaskClipValue?: number
  /** Whether the `opacityMask` output of the material's graph cuts by a dither of the output instead of a hard threshold, so that the temporal pass averages it into a limited translucency. @defaultValue false */ ditherOpacityMask?: boolean
  /** Whether a double-sided see-through surface is drawn in two passes, its back faces then its front faces, so a closed shape shows its far side through its near one; false draws both sides in one pass that culls neither, as the reference does. The two passes cost the surface twice the draws. @defaultValue false */ twoSidedPasses?: boolean
  /** Whether the roughness is raised to at least the one the change of the vertex normal across the pixel gives it (a curved surface far away reads rougher, so its highlight does not flicker). @defaultValue false */ normalCurvatureToRoughness?: boolean
  /** The greatest distance, in metres along each axis, the `worldPositionOffset` output may move a vertex: the offset is held to it, and the bounds of the surface's clusters grow by it where the view and the shadows decide what is seen. 0 holds nothing and grows nothing. @defaultValue 0 */ maxWorldPositionOffset?: number
  /** Whether the `worldPositionOffset` output is evaluated whatever the object's switch (`Object3D.evaluateWorldPositionOffset`) and its distance (`Object3D.worldPositionOffsetDisableDistance`) say. @defaultValue false */ alwaysEvaluateWorldPositionOffset?: boolean
  /** How far, in metres, the `displacement` output of the material's graph moves a surface along its normal where it is 1 above where it is `displacementCenter`: the displaced height is `(output - displacementCenter) * displacementMagnitude`. @defaultValue 4 */ displacementMagnitude?: number
  /** The value of the `displacement` output that leaves the surface where it is, from 0 to 1. @defaultValue 0.5 */ displacementCenter?: number
  /** Where the displacement fades out with distance, as the on-screen size in pixels of its largest displacement: whole above `displacementFadeStart`, gone below `displacementFadeEnd`, which must be the smaller; both left out, it never fades. */ displacementFadeStart?: number
  /** See `displacementFadeStart`. */ displacementFadeEnd?: number
  /** How the lights light a see-through surface: `'forward'`, each light evaluated for the pixel; `'volume'`, `'volumetric'` or `'volumetricNonDirectional'`, read from the translucency lighting volume (`translucencyVolume`), as a surface, as a medium, or as a medium with no direction. @defaultValue 'volumetricNonDirectional' */ translucencyLighting?: TranslucencyLighting
  /** The pass of the image a see-through surface is drawn in: `'afterDepthOfField'`, apart from the scene and laid over the image once the depth of field has read it, so that no blur reaches it; `'beforeDepthOfField'`, into the scene, blurred with it; `'afterMotionBlur'`, laid over the image after the temporal anti-aliasing and the motion blur, so neither smears it. @defaultValue 'afterDepthOfField' */ translucencyPass?: TranslucencyPass
  /** Whether the shadow of a point, spot or rectangle light reaches a see-through surface even where the project switch `shadowTranslucentLocalLights` is off; it is read as `translucentLocalLightShadowQuality` says. @defaultValue false */ translucentLocalLightShadow?: boolean
  /** How a see-through surface reads the shadow of the local lights that reach it, from 0 to 1: above 0 the full trace the opaque surfaces get, at 0 one sample of the light's map (unless the project switch `shadowTranslucentQuality` traces every translucent surface). The lights are shadowed at all where `translucentLocalLightShadow` or the project switch `shadowTranslucentLocalLights` says so. @defaultValue 0 */ translucentLocalLightShadowQuality?: number
  /** How a see-through surface reads the sun's shadow, from 0 to 1: above 0 the full trace the opaque surfaces get, at 0 one sample of the sun's map (unless the project switch `shadowTranslucentQuality` traces every translucent surface). @defaultValue 0 */ translucentDirectionalLightShadowQuality?: number
  /** Whether a see-through surface receives the clouds in front of it as part of its fog, a rough approximation that can help where it lies behind a cloud; the fog is laid on the clouds, so the surface must be fogged. @defaultValue false */ cloudFog?: boolean
  /** Whether the fog of a see-through surface is worked out for each pixel instead of each vertex and interpolated: exact, and dearer. The height fog and the haze of the air are per vertex otherwise; the fog's volume is always read per pixel. @defaultValue false */ computeFogPerPixel?: boolean
  /** Whether the lights cast contact shadows on a see-through surface: from each of its pixels a short ray, 0.2 of the screen's half height at its depth, goes toward each light through the depth of the opaque scene, and the pixel is shadowed where it meets a surface; costs a ray a light in every pixel of the surface. An opaque surface is shadowed by the lights' own rays. @defaultValue false */ contactShadows?: boolean
  /** The matter of a body wearing it: density, friction, restitution. */ physics?: PhysicsMaterialPreset
  /** kg/m³, times the volume for the mass. @defaultValue 1000 */ density?: number
  /** How much a body grips, 0 and up. @defaultValue 0.5 */ friction?: number
  /** How much a body bounces, 0 to 1. @defaultValue 0 */ restitution?: number
  [param: string]: unknown
}
