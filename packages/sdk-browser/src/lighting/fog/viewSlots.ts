/**
 * THE FOG VOLUME'S READ-SIDE VIEW BLOCK, its slots: what every program that reads the volume —
 * the opaque resolve, the translucent layers, the sky — takes of the image the volume was built
 * for, fifteen `vec4f` in the light buffer behind the air's view block (`DirectLights.fogView`,
 * `../atmosphere/layout.ts`), so that it costs no binding, then the view's clip plane, which the
 * analytic fog reads where the volume is not built. The volume's own passes read the whole frame
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
  /** The view's clip plane, `dot(xyz, p) + w` at least 0 kept, with `w` the distance of the eye to
   *  it (`viewClipPlane`, the eye's `dot(xyz, eye)` added): zero for a view that has none, the fog
   *  then starting at its own distance (`heightFogAlong`). */
  clipPlane: 9,
  /** The cells the view uses over the textures' along the screen — where a translucent layer, which
   *  finds its cell by where the point lies in the view, reads —, the offset in pixels a surface
   *  jitters its read by, and the image's number modulo 8, which moves the jitter. */
  stretch: 10,
  /** The fog's switches, each 1 where it departs from the engines' default (so that zero, a block
   *  nobody wrote, is the default): no fog drawn, the atmosphere's light not added, the fog matched
   *  to the volume, the view's own height used for the fog (`ortho`, an orthographic view). */
  options: 11,
  /** How far the held observer's height may lie above the base of a layer, less its 655.36 metres
   *  of a view that looks out from its eye; zero for such a view. */
  observer: 12,
  /** What the fog matched to the volume takes of it: its glow in the engines' unit, and its
   *  scatter. */
  match: 13,
  /** The volume's particle colour, which the matched fog's light is multiplied by. */
  albedo: 14,
} as const

/** `vec4f` slots of the block. */
export const FOG_VIEW_SLOTS = 15
/** Floats of the block. */
export const FOG_VIEW_FLOATS = FOG_VIEW_SLOTS * 4
