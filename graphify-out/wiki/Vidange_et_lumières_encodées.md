# Vidange et lumières encodées

> 57 nodes

## Key Concepts

- **webgpuPagesRender.ts** (33 connections) — `packages/sdk-browser/webgpuPagesRender.ts`
- **pages-webgpu.perf.mjs** (27 connections) — `packages/sdk-browser/bench/pages-webgpu.perf.mjs`
- **webgpuPagesFlush.ts** (27 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **webgpuPagesEncodeLights.ts** (26 connections) — `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- **renderWebgpuPages()** (25 connections) — `packages/sdk-browser/webgpuPagesRender.ts`
- **webgpuPagesPrepareSunFar.ts** (23 connections) — `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- **webgpuPagesRender.test.ts** (18 connections) — `packages/sdk-browser/webgpuPagesRender.test.ts`
- **holdCameraWorld()** (13 connections) — `packages/sdk-browser/cameraWorld.ts`
- **webgpuPagesWinding.ts** (13 connections) — `packages/sdk-browser/webgpuPagesWinding.ts`
- **webgpuPagesWinding.test.ts** (12 connections) — `packages/sdk-browser/webgpuPagesWinding.test.ts`
- **webgpuTransparentOcclusionAudit.ts** (11 connections) — `packages/sdk-browser/webgpuTransparentOcclusionAudit.ts`
- **encodeDirectLights()** (9 connections) — `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- **flushWebgpuPages()** (9 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **fallbackToCpuCut()** (8 connections) — `packages/sdk-browser/webgpuPagesDrops.ts`
- **invalidateOccluderHistory()** (8 connections) — `packages/sdk-browser/webgpuPagesDrops.ts`
- **outputColorDiagnostic()** (8 connections) — `packages/sdk-browser/webgpuPagesHelpers.ts`
- **ensureSunFarShadow()** (8 connections) — `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- **setWindingEpoch()** (8 connections) — `packages/sdk-browser/webgpuPagesWinding.ts`
- **readbackBytesPerRow()** (6 connections) — `packages/sdk-browser/gpuPresentation.ts`
- **readBackImage()** (6 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **reportProgress()** (6 connections) — `packages/sdk-browser/webgpuPagesFlush.ts`
- **ensureBounce()** (6 connections) — `packages/sdk-browser/webgpuPagesPrepareBounce.ts`
- **readTransparentOcclusionAudit()** (6 connections) — `packages/sdk-browser/webgpuTransparentOcclusionAudit.ts`
- **gpuReadback.ts** (6 connections) — `packages/sdk-browser/gpuReadback.ts`
- **rootWorldsToRenderOrigin()** (5 connections) — `packages/sdk-browser/gpuDagPack.ts`
- *... and 32 more nodes in this community*

## Relationships

- [Sélection DAG et pages WebGPU](Sélection_DAG_et_pages_WebGPU.md) (20 shared connections)
- [sdk-browser · CpuStepSummary](sdk-browser_·_CpuStepSummary.md) (16 shared connections)
- [Encodage des dessins WebGPU](Encodage_des_dessins_WebGPU.md) (15 shared connections)
- [Caméra monde et contrat](Caméra_monde_et_contrat.md) (11 shared connections)
- [Pyramide Hi-Z et occlusion](Pyramide_Hi-Z_et_occlusion.md) (11 shared connections)
- [sdk-browser · DrawnMirror](sdk-browser_·_DrawnMirror.md) (11 shared connections)
- [Pipelines de visibilité](Pipelines_de_visibilité.md) (11 shared connections)
- [sdk-browser · SunFarCounts](sdk-browser_·_SunFarCounts.md) (8 shared connections)
- [Transformations et collecte des pages](Transformations_et_collecte_des_pages.md) (7 shared connections)
- [Contrat backend et dessin](Contrat_backend_et_dessin.md) (7 shared connections)
- [sdk-browser · CaptureOptions](sdk-browser_·_CaptureOptions.md) (7 shared connections)
- [Sondes et rebond GPU](Sondes_et_rebond_GPU.md) (6 shared connections)

## Source Files

- `packages/sdk-browser/bench/oracles/pages-webgpu.mjs`
- `packages/sdk-browser/bench/pages-webgpu.perf.mjs`
- `packages/sdk-browser/cameraRenderOrigin.ts`
- `packages/sdk-browser/cameraWorld.ts`
- `packages/sdk-browser/gpuDagPack.ts`
- `packages/sdk-browser/gpuPresentation.ts`
- `packages/sdk-browser/gpuReadback.ts`
- `packages/sdk-browser/webgpuBlendWorlds.ts`
- `packages/sdk-browser/webgpuPagesDrops.ts`
- `packages/sdk-browser/webgpuPagesEncodeLights.ts`
- `packages/sdk-browser/webgpuPagesEncodeShadowPass.ts`
- `packages/sdk-browser/webgpuPagesFlush.ts`
- `packages/sdk-browser/webgpuPagesHelpers.ts`
- `packages/sdk-browser/webgpuPagesPrepareBounce.ts`
- `packages/sdk-browser/webgpuPagesPrepareSunFar.ts`
- `packages/sdk-browser/webgpuPagesRender.test.ts`
- `packages/sdk-browser/webgpuPagesRender.ts`
- `packages/sdk-browser/webgpuPagesStateLights.ts`
- `packages/sdk-browser/webgpuPagesWinding.test.ts`
- `packages/sdk-browser/webgpuPagesWinding.ts`

## Audit Trail

- EXTRACTED: 294 (99%)
- INFERRED: 4 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*