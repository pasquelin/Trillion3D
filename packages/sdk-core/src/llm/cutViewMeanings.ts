import type { CutField } from '../contracts/cutOptions.ts'

/** The settings of the cut that govern what a view carries beside its eye (`../contracts/viewOptions.ts`). */
export type CutViewField = Extract<
  CutField,
  'cutClipPlane' | 'cutClipPlaneCulling' | 'cutViewFiltering'
>

/** What each of them means (`../contracts/cutOptions.ts`). */
export const CUT_VIEW_MEANINGS: Readonly<Record<CutViewField, string>> = {
  cutClipPlane:
    "Whether a view's clip plane applies: a camera's clipPlane — a point of the plane and the normal toward the side that is drawn — clips what its view draws; the cut culls what lies wholly behind it and the raster cuts what straddles it. Shadows are not clipped. false, a view's plane is ignored.",
  cutClipPlaneCulling:
    "Whether the cut culls an object, a node or a cluster that lies wholly behind a view's clip plane, and flags the ones that straddle it for the raster's cut; false, the cut tests nothing against the plane. No effect while cutClipPlane is off.",
  cutViewFiltering:
    "Whether a view's lists apply: the objects a camera hides (hidden) are not drawn by its view, with everything under them, and, when it names showOnly, only the objects that list names, with what is under them, are — an empty list draws none; false, every view draws every object.",
}
