/**
 * THE FOG VOLUME'S READ-SIDE VIEW BLOCK, its slots: what every program that reads the volume —
 * the opaque resolve, the translucent layers, the sky — takes of the image the volume was built
 * for, twelve `vec4f` in the light buffer behind the air's view block (`DirectLights.fogView`,
 * `../atmosphere/layout.ts`), so that it costs no binding. The volume's own passes read the whole
 * frame (`layout.ts`); this is the part a surface needs to find its cell.
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
} as const

/** `vec4f` slots of the block. */
export const FOG_VIEW_SLOTS = 12
/** Floats of the block. */
export const FOG_VIEW_FLOATS = FOG_VIEW_SLOTS * 4
