// The bounce sizes read before any pass is built — the binding plan (`limits.ts`) and the memory
// budget's probe share (`../residency/shadowBudgetBytes.ts`) — kept apart from the shader texts, so
// that the CDN core, which holds the budget, holds none of the WebGPU passes (#1353).

/** Header words of the resident proxy, before the first column (`nodeWgsl.ts`). */
export const PROXY_HEADER_WORDS = 17;
export const PROXY_HEADER_BYTES = PROXY_HEADER_WORDS * 4;
/** Surface-cache texels: two faces per proxy triangle, at least one (`surfaceWgsl.ts`). */
export const surfaceCacheTexels = (triangleCount: number) => Math.max(1, triangleCount * 2);
