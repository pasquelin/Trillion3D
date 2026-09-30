import { onDemand } from './onDemand.ts';

/**
 * The engine's optional families (#1353), each the code of one module the CDN bundle makes a chunk
 * of its own (`scripts/bundle-fold.ts`, `FAMILY_MODULES`): a page whose scene uses none of them
 * downloads none. A family is started where its use becomes known — the scene's load, which
 * reads its objects and materials, or the public call that enables it — and what uses it waits
 * for it as for any other resource of the scene (`familiesArriving`): the session opens once
 * they have arrived, and a frame that would draw one still on its way is not drawn. Physics loads
 * its own session the same way (`../physics/worldPhysics.ts`).
 */
export const families = {
  /** The particle steps and draws of both renderers. */
  particles: onDemand(() => import('../particles/particleCode.ts')),
  /** WebGPU transmission: the water pass every transmissive surface draws through, glass too. */
  transmission: onDemand(() => import('../webgpu/water/transmissionCode.ts')),
  /** WebGPU skinning, morphing and the waves of `mesh.waves`. */
  deformation: onDemand(() => import('../deformation/deformationCode.ts')),
  /** The effect chain's passes on both renderers. */
  effects: onDemand(() => import('../effects/effectCode.ts')),
  /** The guide passes of both renderers. */
  guides: onDemand(() => import('../guides/guideCode.ts')),
  /** The diagnostic views: the host graph's, and the WebGPU feedback A/B measurements. */
  diagnostics: onDemand(() => import('../diagnostic/viewCode.ts')),
  /** The build provenance table a measurement reads. */
  measurement: onDemand(() => import('../measurement/buildProvenance.ts')),
};
export type FamilyName = keyof typeof families;

/**
 * Starts every family of `names`; answers a promise that settles once each has arrived — or was
 * refused, which what uses it tells as its own refusal —, `undefined` when all already have.
 */
export function familiesArriving(names: Iterable<FamilyName>): Promise<void> | undefined {
  let waits: Promise<void>[] | undefined;
  for (const name of names) {
    const family = families[name];
    family.get();
    if (!family.arrived) (waits ??= []).push(family.settled());
  }
  return waits && Promise.all(waits).then(() => undefined);
}
