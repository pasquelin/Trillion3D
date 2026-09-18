# Vidange et lumières encodées

> 38 nodes · cohesion 0.11

## Key Concepts

- **webgpuPagesRender.ts** (33 connections) — `packages/sdk-browser/webgpuPagesRender.ts`
- **webgpuPagesFlush.ts** (27 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **webgpuPagesEncodeLights.ts** (26 connections) — `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- **renderWebgpuPages()** (25 connections) — `packages/sdk-browser/webgpuPagesRender.ts`
- **webgpuPagesPrepareSunFar.ts** (23 connections) — `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- **webgpuPagesEncodeShadowPass.ts** (15 connections) — `packages/sdk-browser/webgpuPagesEncodeShadowPass.ts`
- **webgpuPagesWinding.ts** (13 connections) — `packages/sdk-browser/webgpuPagesWinding.ts`
- **encodeDirectLights()** (9 connections) — `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- **flushWebgpuPages()** (9 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **wantsContractLighting()** (9 connections) — `packages/sdk-browser/webgpuPagesLightResources.ts`
- **fallbackToCpuCut()** (8 connections) — `packages/sdk-browser/webgpuPagesDrops.ts`
- **invalidateOccluderHistory()** (8 connections) — `packages/sdk-browser/webgpuPagesDrops.ts`
- **ensureSunFarShadow()** (8 connections) — `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- **setWindingEpoch()** (8 connections) — `packages/sdk-browser/webgpuPagesWinding.ts`
- **readbackBytesPerRow()** (6 connections) — `packages/sdk-browser/gpuPresentation.ts`
- **createGpuSunFarShadow()** (6 connections) — `packages/sdk-browser/gpuSunFarShadow.ts`
- **readBackImage()** (6 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **reportProgress()** (6 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **rootWorldsToRenderOrigin()** (5 connections) — `packages/sdk-browser/gpuDagPack.ts`
- **invalidateTemporalPyramid()** (5 connections) — `packages/sdk-browser/webgpuPagesDrops.ts`
- **sameRenderOrigin()** (4 connections) — `packages/sdk-browser/cameraRenderOrigin.ts`
- **readGpuImage()** (4 connections) — `packages/sdk-browser/gpuPresentation.ts`
- **directLightingState()** (4 connections) — `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- **encodeShadowAtlas()** (4 connections) — `packages/sdk-browser/webgpuPagesEncodeShadowPass.ts`
- **sunFarCounts()** (4 connections) — `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- *... and 13 more nodes in this community*

## Relationships

- [Pyramide Hi-Z et occlusion](Pyramide_Hi-Z_et_occlusion.md) (16 shared connections)
- [sdk-browser · CaptureOptions](sdk-browser_·_CaptureOptions.md) (14 shared connections)
- [Encodage des dessins WebGPU](Encodage_des_dessins_WebGPU.md) (13 shared connections)
- [Encodage des dessins WebGPU (2)](Encodage_des_dessins_WebGPU_2.md) (12 shared connections)
- [Sélection DAG et pages WebGPU](Sélection_DAG_et_pages_WebGPU.md) (11 shared connections)
- [sdk-browser · DrawnMirror](sdk-browser_·_DrawnMirror.md) (9 shared connections)
- [sdk-browser · SunFarCounts](sdk-browser_·_SunFarCounts.md) (7 shared connections)
- [Faces et volumes d'ombre](Faces_et_volumes_d'ombre.md) (6 shared connections)
- [Sondes et rebond GPU](Sondes_et_rebond_GPU.md) (6 shared connections)
- [Plan de mélange des transparents](Plan_de_mélange_des_transparents.md) (6 shared connections)
- [sdk-browser · tilesOn](sdk-browser_·_tilesOn.md) (5 shared connections)
- [Matrices et origine de rendu](Matrices_et_origine_de_rendu.md) (3 shared connections)

## Source Files

- `packages/sdk-browser/cameraRenderOrigin.ts`
- `packages/sdk-browser/gpuDagPack.ts`
- `packages/sdk-browser/gpuPresentation.ts`
- `packages/sdk-browser/gpuSunFarShadow.ts`
- `packages/sdk-browser/webgpuPagesDrops.ts`
- `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- `packages/sdk-browser/webgpuPagesEncodeShadowPass.ts`
- `packages/sdk-browser/webgpuPagesEncodeShadows.ts`
- `packages/sdk-browser/webgpuPagesFlush.ts`
- `packages/sdk-browser/webgpuPagesLightResources.ts`
- `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- `packages/sdk-browser/webgpuPagesRender.ts`
- `packages/sdk-browser/webgpuPagesStateLights.ts`
- `packages/sdk-browser/webgpuPagesWinding.ts`

## Audit Trail

- EXTRACTED: 231 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*