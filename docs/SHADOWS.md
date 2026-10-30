# Shadows

Cast shadows of the WebGPU engine: virtual shadow maps, whose pages exist in memory only where the
image reads them. A map: each rule is stated where it lives; this page names the files and the
rules spanning files. Paths are under `packages/sdk-browser/src/`: `vsm/` holds the passes and
shaders, `lighting/shadows/vsm/frame/` the frame's plan, grant and encoding. Lights, tiles and the
lit image's passes: [ENGINE.md](engine/direct-lighting.md#direct-lighting). Page options
(`castShadow`, a primitive's `castsShadowMaps`, a material's `translucentLocalLightShadow`,
`translucentLocalLightShadowQuality`, `translucentDirectionalLightShadowQuality`):
[SDK.md](sdk/lights.md#lights).

Each section lives in its own file under [`shadows/`](shadows); read only the one you need.

## Pages and the pool
[shadows/pages-and-the-pool.md](shadows/pages-and-the-pool.md)

## Memory
[shadows/memory.md](shadows/memory.md)

## One frame
[shadows/one-frame.md](shadows/one-frame.md)

## Local lights' shadow gates and distant lights
[shadows/local-lights-shadow-gates-and-distant-lights.md](shadows/local-lights-shadow-gates-and-distant-lights.md): Distant lights

## Classic shadow maps
[shadows/classic-shadow-maps.md](shadows/classic-shadow-maps.md)

## Far casters
[shadows/far-casters.md](shadows/far-casters.md)

## Reading the shadow
[shadows/reading-the-shadow.md](shadows/reading-the-shadow.md)

## Contact shadows
[shadows/contact-shadows.md](shadows/contact-shadows.md)

## Metrics
[shadows/metrics.md](shadows/metrics.md)
