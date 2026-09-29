/** Actual active allocations admitted by the existing global split. Shadow bytes
 * include static/transmission/request storage once, plus held batch buffers. Frame
 * targets include the other live views and the proposed replacement of this view.
 * Minima come from the existing poolFor(1) rules, including vertex/live storage. */
export interface ActiveGpuMemory {
  frameTargets: number;
  shadowPool: number;
  bounceProbes: number;
  effectTargets: number;
  geometryMinimum: number;
  textureMinimum: number;
}

/** The world's existing budget supplies this transaction to its rendering session. */
export type AdmitGpuMemory = ((active: ActiveGpuMemory) => {
  geometryPoolBytes: number;
  texturePoolBytes: number;
}) & {
  /** The same owning budget, read immediately before GPU allocation. */ readonly limit?: () => number;
};

export function validateActiveMemory(active: ActiveGpuMemory) {
  for (const [name, bytes] of Object.entries(active))
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error(`INVALID_GPU_RESERVATION: ${name}=${bytes}`);
}

/** Divide only the unreserved bytes, honoring irreducible coverage before equal
 * shares. A minimum is never silently raised after this admission decision. */
export function admittedPools(
  available: number,
  geometryMinimum: number,
  textureMinimum: number,
  geometryCeiling: number,
  textureCeiling: number,
) {
  const required = geometryMinimum + textureMinimum;
  if (available < required)
    throw new Error(`GPU_BUDGET_UNDER_MINIMUM: available=${available}, required=${required}`);
  const geometryMax = Math.max(geometryMinimum, geometryCeiling);
  const textureMax = Math.max(textureMinimum, textureCeiling);
  let geometryPool = Math.min(geometryMax, Math.max(geometryMinimum, Math.floor(available / 2)));
  let texturePool = Math.min(textureMax, Math.max(textureMinimum, available - geometryPool));
  geometryPool = Math.min(geometryMax, available - texturePool);
  texturePool = Math.min(textureMax, available - geometryPool);
  return { geometryPool, texturePool };
}
