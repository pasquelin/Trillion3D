# The custom depth and stencil

While an object asks (`Object3D.renderCustomDepth`, `customDepth` not 0), `renderCustomDepth`
(`frame/render/encodeCustomDepth.ts`) draws the main view's image again before the main view, in a
persistent view of its own (`ViewOverrides.customDepthCapture`: no lighting, shadow, fog, sky or
effect). It has the main view's camera, size and lists; roots of objects that do not ask are left out
of its cut (`writeCutViewSet`, the roots the view does not draw), so nothing in front of an asking
object hides it. The request, stencil value and write mask are one word (`customDepthWord`,
`contracts/customDepthAbi.ts`) held by the object's root (`RootOffsetRow.customDepth`) and written to
its placement's record (`PlacementInfo.customDepth`, in the record's padding); `createRootOffsets` lists
the asking roots (`askingCustomDepth`). The view's image is the rastered visibility; in place of
shading, `encodeCustomDepthView` runs the emission (`visibility/customDepth/customDepthEmit.ts`), one
full-screen pass writing, for each pixel showing a cluster, the view's depth into the custom depth
target (`depth32float`, cleared to the far) and, in the stencil-writing mode, the cluster's object value
(its value under its mask, the whole value for the default mask) into the second channel of the stencil
target (`rg16uint`). The targets are made when an object first asks (`customDepth` 1 gives them back,
with the view, when none does; 2 and 3 keep them) and are retired, never destroyed.
