import type { CutField } from '../contracts/cutOptions.ts'

/** The settings of the cut that govern what a view carries beside its eye (`../contracts/viewOptions.ts`)
 *  and where an orthographic view's origin and range stand. */
export type CutViewField = Extract<
  CutField,
  | 'cutClipPlane'
  | 'cutClipPlaneCulling'
  | 'cutViewFiltering'
  | 'cutViewOrthoAutoPlanes'
  | 'cutViewOrthoAutoPlanesHalfFloat'
  | 'cutViewOrthoAutoPlanesScaleUnits'
  | 'cutViewOrthoAutoPlanesDepthScale'
  | 'cutViewOrthoAutoPlanesShift'
  | 'cutViewOrthoNearPlaneCorrection'
  | 'cutViewOrthoCameraHeightAsViewTarget'
  | 'cutViewOrthoNearPlane'
  | 'cutViewCaptureDelay'
>

/** What each of them means (`../contracts/cutOptions.ts`). */
export const CUT_VIEW_MEANINGS: Readonly<Record<CutViewField, string>> = {
  cutClipPlane:
    "The project switch of the clip plane, read once when the session opens (changing it later changes nothing): a camera's clipPlane — a point of the plane and the normal toward the side that is drawn — clips what its view draws; the cut culls what lies wholly behind it, every pass that draws the scene's geometry cuts what straddles it, and the fog starts at it. Shadows are not clipped. false, the default, no program holds any of that code and a view's plane is ignored.",
  cutClipPlaneCulling:
    "Whether the cut culls an object, a node or a cluster that lies wholly behind a view's clip plane, and flags the ones that straddle it for the raster's cut; false, the cut tests nothing against the plane. No effect while cutClipPlane is off.",
  cutViewFiltering:
    "Whether a view's lists apply: the objects a camera hides (hidden) are not drawn by its view, with everything under them, and, when it names showOnly, only the objects that list names, with what is under them, are — an empty list draws none; false, every view draws every object.",
  cutViewOrthoAutoPlanes:
    "Whether an orthographic view works out its near and far plane itself from its box, its angle to the ground, its distance to the point it frames and the size of its picture (true, the default), and carries that point (the camera's viewTarget) into the shadows' clipmaps and the correction below; false, the view keeps the camera's near and far, and no target. A perspective view is never worked out.",
  cutViewOrthoAutoPlanesHalfFloat:
    "Whether the far plane of a view whose planes are worked out scales with the size of a pixel in the world, from the half float's largest depth, so a pass that downsizes depth in half floats keeps it (true, the default); false, the far plane follows the view's angle alone, the flatter the farther. Read where cutViewOrthoAutoPlanes is on.",
  cutViewOrthoAutoPlanesScaleUnits:
    "Whether that scale follows the logarithm of the pixel's size, which lets the far plane grow with the picture's reach up to the largest world (true, the default). Read where cutViewOrthoAutoPlanesHalfFloat is on.",
  cutViewOrthoAutoPlanesDepthScale:
    "The depth, in metres, the half-float scale starts from where above 0, no more than the half float's largest (655.04 m); at 0 or under, the default, the half float's largest. A shorter depth gives the depth buffer finer steps. Read where cutViewOrthoAutoPlanesHalfFloat is on.",
  cutViewOrthoAutoPlanesShift:
    'How far, in metres, a view whose planes are worked out has both shifted along the view: positive away from the origin, negative toward it, the range keeping its length (0, the default). For a level view of a flat scene that needs its near plane closer. Read where cutViewOrthoAutoPlanes is on.',
  cutViewOrthoNearPlaneCorrection:
    "Whether an orthographic view moves its origin onto its near plane, so the origin is no farther from what is drawn than the range needs and the light resolved at the origin (the shadows' clipmaps) is resolved where the picture begins (true, the default). A view that frames a target (the camera's viewTarget, carried while cutViewOrthoAutoPlanes is on) puts its origin on the target, then along the view by the near plane; the range then starts at cutViewOrthoNearPlane and keeps its length. false leaves the origin and the range as declared. A perspective view is never moved.",
  cutViewOrthoCameraHeightAsViewTarget:
    "Whether an orthographic view that frames no target moves its origin farther along the view by its own height above the ground (the lesser of that height and the box's half width), as the target it lacks (true, the default), the more the view looks straight down. Read where cutViewOrthoNearPlaneCorrection is on.",
  cutViewOrthoNearPlane:
    "The near plane, in metres, an orthographic view's range starts at once its origin has moved (0, the default); the range keeps its length. Read where cutViewOrthoNearPlaneCorrection is on.",
  cutViewCaptureDelay:
    "How many images an image captured aside (capture.surface, capture.buffer) draws of its view before it reads the last (4, the default; less than 1 reads as 1), the first being the one that finds its cut whole, so the effects that need images to converge have them. The view's temporal antialiasing, when the world has it on, accumulates them from a history of its own; below 4 it is off for the last image alone. The capture shows no motion blur.",
}
