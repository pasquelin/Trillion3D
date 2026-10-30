# Memory

The set, the mask and the raster's lists are granted within the room
the GPU budget leaves the shadows (`lighting/shadows/vsm/frame/vsmGrant.ts:grantEngineVsm`); their
total is `shadowPoolBytes` (`lighting/shadows/vsm/frame/vsmStats.ts`). Rules a contributor keeps:

- **Fixed size.** The physical pool is the setting's (`shadowMaxPhysicalPages`, rounded up to whole
  rows of 128 pages, as the reference rounds it), held to what one binding of the device holds
  (`vsmAsked`, `lighting/shadows/vsm/frame/vsmLightMaps.ts`). It follows neither the view's size nor
  its fill: a full pool raises the global resolution bias instead (below).

- **Never a crash, never an allocation the budget refuses.** Past the room, the pool is made with
  half the pages, down to an eighth: coarser shadows, said once (`gpu-out-of-memory`). When not
  even an eighth fits, the lights read no shadow, by name, until the room holds it or the lights
  change. A set the device refuses is undone whole and asked again only for other lights.
- **Coarser, then finer again.** A pool the GPU budget drew short of the setting (no part of the reference) grows back to it once the room holds it, at most
  every `VSM_PRESSURE_CALM_FRAMES` (`shadow-pool-regrown`). A full pool raises a global resolution
  bias (`VsmCacheManager.readPoolFeedback`, `vsm/cacheManager.ts`).
- **Said, never hidden.** `shadowResolutionBias` is the pool's halvings from the one asked plus that bias, which reads
  `0` once its fall has stalled under `VSM_PRESSURE_BIAS_NONE` (a bias no level feels); above `0` the reference mode
  refuses its capture (`REFERENCE_SHADOWS_REDUCED`).
