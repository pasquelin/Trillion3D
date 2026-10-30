# The frame, in order

One WebGPU image is one command buffer, encoded in this order:

| Stage | Code |
| --- | --- |
| Frame gate: camera copy, held-frame test, pipelines asked | `gate/gateCore.ts`, `frame/loop/hold.ts`, `src/frame/render/render.ts` |
| World poses uploaded | `src/frame/render/worldUpload.ts` |
| GPU deformation | `deformation/compute.ts` |
| Composed placements | `compose/gpuCompose.ts` |
| Cut: GPU selection, the engine's one cut | `src/frame/render/gpuCut.ts` |
| Decode and bins of the cut's main pass's visible clusters | `visibility/decode/decode.ts`, `visibility/bins/bins.ts` |
| Visibility raster, the cut's post pass between its halves | `visibility/passes/passes.ts` |
| Material surfaces, one dispatch per class | `materials/classes/materialPasses.ts` |
| Surface cache: card pages captured, once a raster is plugged | `lighting/surfaceCache/frame.ts` |
| Surface cache: the cards' texels lit, after the lights go up | `lighting/surfaceCache/lighting/frame.ts` |
| Light buffer, bounce, light grid, virtual shadow maps | `src/frame/render/encodeLights.ts` |
| Lit image: tile classes, colour, sun, local lights, indirect | `lighting/deferred/deferred.ts` |
| Sky, height fog, haze on the surfaces, clouds | `src/frame/render/encodeClouds.ts` |
| Transparents, distortion, particles | `src/frame/render/encodeBlend.ts` |
| Temporal resolve | `taa/frame.ts` |
| Exposure: histogram and update of the image composed | `post/exposure/meter.ts` |
| Finishing: scene chain, local exposure's grid and blur | `post/finish/frame.ts` |
| Effect chain (bloom) | `src/frame/render/encodeEffects.ts` |
| Composition, presentation, submission | `lighting/deferred/deferred.ts`, `src/frame/render/encoder.ts` |

`src/frame/render/surfaceLighting.ts` encodes the stages from the light buffer on.
