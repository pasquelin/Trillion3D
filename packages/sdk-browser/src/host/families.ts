import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { onDemand } from './onDemand.ts';

/** Who hears a family's final refusal (`FAMILY_LOAD_FAILED`): each open world, on its error
 *  channel (`world.diagnostic.error`, `worldHandles.ts`), until it closes. */
export const familyRefusals = new Set<(error: EngineError) => void>();
const told = (error: EngineError) => familyRefusals.forEach((listener) => listener(error));
/** One family of the table: its name, the one loader (`onDemand.ts`), its refusal told. */
const family = <M>(name: string, load: () => Promise<M>) => onDemand(name, load, told);

/**
 * The engine's optional families (#1353), each the code of one module the CDN bundle makes a chunk
 * of its own (`scripts/bundle-fold.ts`, `FAMILY_MODULES`): a page whose scene uses none of them
 * downloads none. A family is started where its use becomes known — the scene's load, which
 * reads its objects and materials, or the public call that enables it — and what uses it waits
 * for it as for any other resource of the scene (`familiesArriving`): the session opens once
 * they have arrived, and a frame that would draw one still on its way is not drawn. A family that
 * could not load keeps the frames that draw with it waiting, and is asked again (`onDemand.ts`).
 */
export const families = {
  /** The physics session and its worker (`../physics/worldPhysics.ts`). */
  physics: family('physics', () => import('../physics/session.ts')),
  /** The particle steps and draws of both renderers. */
  particles: family('particles', () => import('../particles/particleCode.ts')),
  /** WebGPU transmission: the water pass every transmissive surface draws through, glass too. */
  transmission: family('transmission', () => import('../webgpu/water/transmissionCode.ts')),
  /** WebGPU skinning, morphing and the waves of `mesh.waves`. */
  deformation: family('deformation', () => import('../deformation/deformationCode.ts')),
  /** The effect chain's passes on both renderers. */
  effects: family('effects', () => import('../effects/effectCode.ts')),
  /** The guide passes of both renderers. */
  guides: family('guides', () => import('../guides/guideCode.ts')),
  /** The diagnostic views: the host graph's, and the WebGPU feedback A/B measurements. */
  diagnostics: family('diagnostics', () => import('../diagnostic/viewCode.ts')),
  /** The measurement's build provenance table and comparison compositor. */
  measurement: family('measurement', () => import('../measurement/measurementCode.ts')),
  /** The world pages' server, under their detached source (`../scene/worldRoots.ts`, `stream`). */
  worldStream: family('world stream', () => import('../scene/worldPageServe.ts')),
  /** The impostor draw of both renderers: card plan, pipelines or program, atlas feed. */
  impostors: family('impostors', () => import('../impostor/impostorCode.ts')),
};
export type FamilyName = keyof typeof families;

/**
 * Starts every family of `names`; answers a promise that settles once each round in flight is over —
 * arrived, or refused and told —, `undefined` when all have arrived.
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
