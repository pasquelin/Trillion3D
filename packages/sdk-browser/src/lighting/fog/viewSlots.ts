/**
 * THE FOG VOLUME'S READ-SIDE VIEW BLOCK, its slots: what every program that reads the volume —
 * the opaque lit passes, the translucent layers, the sky — takes of the image the volume was built
 * for, twenty-one `vec4f` in the light buffer behind the air's view block (`DirectLights.fogView`,
 * `../atmosphere/layout.ts`), so that it costs no binding, the view's clip plane, which the
 * analytic fog reads where the volume is not built, among them. The volume's own passes read the whole frame
 * (`layout.ts`); this is the part a surface needs to find its cell.
 */
export const FOG_VIEW_SLOT = {
  /** The first column of the view-projection the volume was built with (the other three follow). */
  projection: 0,
  /** The eye, and 1 where the volume was built for this image, 0 where it was not. */
  eye: 4,
  /** The view's unit forward, and the filter a surface reads the volume through
   *  (`VOLUMETRIC_FOG_FILTERS`' index). */
  forward: 5,
  /** The numbers `B`, `O`, `S` the slice of a depth is `log2(depth · B + O) · S` by, and the
   *  inverse of the slices. */
  sliceMap: 6,
  /** The view's size over the cells' span, and the last coordinate a read takes. */
  uv: 7,
  /** The cells the textures hold across, down and along the depth, and the cell's side in pixels. */
  grid: 8,
  /** The volume's pre-exposure (`x`), the ratio of it to the history's (`y`) and the reciprocal of
   *  it (`z`), which a read multiplies the light of a cell by to have the light as it is. */
  exposure: 9,
  /** The light shafts' occlusion mask the fog reads, written by the pass that draws it
   *  (`../../modules/sky/lightShafts/maskWgsl.ts`) after the volume's block is: the bounds of the
   *  mask's reads, `(minX, minY, maxX, maxY)` in texture coordinates, then the scene's texture
   *  size in `xy` and its inverse in `zw`. */
  lightShaftBounds: 10,
  lightShaftScene: 11,
  /** The view's clip plane, `dot(xyz, p) + w` at least 0 kept, with `w` the distance of the eye to
   *  it (`viewClipPlane`, the eye's `dot(xyz, eye)` added): zero for a view that has none, the fog
   *  then starting at its own distance (`heightFogAlong`). */
  clipPlane: 12,
  /** The cells the view uses over the textures' along the screen — where a translucent layer, which
   *  finds its cell by where the point lies in the view, reads —, the offset in pixels a surface
   *  jitters its read by, and the image's number modulo 8, which moves the jitter. */
  stretch: 13,
  /** The fog's switches, each 1 where it departs from the engines' default (so that zero, a block
   *  nobody wrote, is the default): no fog drawn, the atmosphere's light not added, the fog matched
   *  to the volume, the view's own height used for the fog (`ortho`, an orthographic view). */
  options: 14,
  /** How far the held observer's height may lie above the base of a layer, less its 655.36 metres
   *  of a view that looks out from its eye; zero for such a view. */
  observer: 15,
  /** What the fog matched to the volume takes of it: its glow in the engines' unit, and its
   *  scatter. */
  match: 16,
  /** The volume's particle colour, which the matched fog's light is multiplied by. */
  albedo: 17,
  /** The height fog in this view: 1 in `x` where the view does not show it (its `inMainView` or
   *  `inReflectionCaptures` off), else 0; then the sky light's scattering — its strength (`y`, 0
   *  where it does not apply this image), its roughness (`z`) and the count of mips of the cube
   *  (`w`), which the read takes the mip of the roughness from. */
  heightFog: 18,
  /** The sky light's colour, linear, the cube read for the fog is multiplied by. */
  skyLightColour: 19,
  /** The alpha holdout (`../../frame/prepare/alphaHoldout.ts`) as this view has it: 1 in `x` where
   *  the height fog holds its light out (`SceneHeightFog.holdout`), else 0. */
  holdout: 20,
} as const

/** How far above the base of a layer with a density the held observer's height may lie, metres, for
 *  a view that looks out from its eye: 65 536 centimetres. The observer lane of an orthographic
 *  view holds its height less it, and the shader adds it back (`fogObserverLimit`). */
export const FOG_OBSERVER_REACH = 655.36

/** `vec4f` slots of the block. */
export const FOG_VIEW_SLOTS = 21
/** Floats of the block. */
export const FOG_VIEW_FLOATS = FOG_VIEW_SLOTS * 4
