# Pages and the pool

Every map is virtual: a page table over a fixed physical page pool in two slices, dynamic and
static. The sizes are tuning values the engine declares, each with its reason, in
`vsm/constants.ts` (`VSM_PAGE_TEXELS`, `VSM_LEVEL0_PAGES`, `VSM_MIPS`, `VSM_POOL_PAGES`); the
buffers are `vsm/resources.ts`. A light takes no page of its own: the pixels mark the pages they
read, only those are allocated and drawn, and a page nobody marks is evicted when a new one needs
room, in the order of the pool rank every GPU pool evicts by (`vsm/freePagesWgsl.ts`). The set is made at the first lit frame with a casting light, sized for the lights that cast
(`lighting/shadows/vsm/frame/engineVsm.ts:fullMapsFor`), and grows with its cache kept
(`lighting/shadows/vsm/frame/vsmGrant.ts:growEngineVsm`).
