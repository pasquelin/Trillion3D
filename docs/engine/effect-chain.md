# Effect chain

`world.effects` (`sdk-core/world/effect/`; API in [SDK.md](../sdk/canvas-camera-and-teardown.md#canvas-camera-and-teardown)) runs
over linear radiance between the temporal resolve and tone mapping:
`post/effects/webgpuEffects.ts`, one table of pass kinds. An empty chain adds no pass; bloom is `post/effects/bloom/`, [the display finishing](the-display-finishing.md#the-display-finishing).
The passes after tone mapping draw over the composed display image and the canvas
(`encodeOverlayEffects`); an idle pass (an outline of no object) is passed by. The outline
(`effects/outline/outlineWgsl.ts`) reads the visibility identifiers through the page table to each
pixel's root (`pages[row].placement`) and one bit per root its objects' subtrees draw, then an
exact separable distance in two passes scissored to the roots' projected boxes (`rootsRect.ts`).
