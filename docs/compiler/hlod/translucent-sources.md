# Translucent sources

A translucent source — one that transmits light (`KHR_materials_transmission`) or one drawn
alpha-blended — is baked by default as it is seen through (`translucency: 'seenThrough'`), on
every level alike, so a far glass tower keeps the tint it has up close. The engine draws such a
surface as a layer over what lies behind it: its own lit layer covers a share `c` of the pixel —
its opacity where it is blended, times, where it transmits, `max(1 − transmission, metallic)` —, and what lies behind it shows through the rest. A baked texel is opaque, so each
of its channels — base colour, roughness, metallic — holds `c` of the surface's own value and
`1 − c` of the value of the first opaque surface behind it, translucent layers composing front to
back (eight at most); where nothing opaque lies behind, the last layer met stands for it, so a
pane against the sky keeps its own colour. The normal is the outermost surface's. An
`approximate` layer's views compose the layers along each pixel's ray; a `merge` layer's atlas
bakes a translucent material on its mesh and composes each texel over what the ray from it inward
along its normal meets among the merged objects. The absorption colour and the Fresnel the engine
lays on the light passing through are not baked: they tint light, which no material channel
holds. For the curtain wall of a tower — base colour 0.35/0.45/0.55, metallic 0.3, roughness
0.06, transmission 0.4 — `c` is 0.6: the texel holds 0.6 of the pane over 0.4 of the core behind
it. `surfaceOnly` bakes the surface alone: an approximation's views skip it and show what lies
behind, a merged atlas bakes its own colour.
