// A texture pool that fills: its budget derived from what the scene itself holds resident, never a
// number tuned for one scene. Read by `harness/options.ts` in Node and `harness/measurePage.ts` in the page.
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts';
import type { MeasuredWorld } from '../../witnesses/measurement.ts';

/** The fraction of the resident working set a live texture pool asked as `<n>%` takes, or `undefined`
 *  when the value is not a percentage (then a number of MiB). */
export function residentFraction(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (!match) return undefined;
  const fraction = Number(match[1]) / 100;
  if (!(fraction > 0 && fraction < 1))
    throw new Error('a live texture pool of <n>% must lie strictly between 0 and 100 %');
  return fraction;
}

/** The texture pool budget, in bytes, for `fraction` of the `residentBytes` the settled pose holds.
 *  The engine gives each of its two atlases half the budget (`texturePoolFor`) and publishes one
 *  residency for both, so the budget is twice the fraction: each atlas may spend `fraction` of the
 *  whole working set, never less than `fraction` of its own: a lower bound, the engine's floor of
 *  layers aside (`README.md`). */
export function residentFractionBudget(fraction: number, residentBytes: number | undefined) {
  if (typeof residentBytes !== 'number' || !(residentBytes > 0))
    throw new Error('the pose holds no texture tile: no working set to take a fraction of');
  return Math.max(1, Math.round(2 * fraction * residentBytes));
}

/** The texture bytes the pose holds once `settle` has held it, and the budget `fraction` of them
 *  asks (`residentFractionBudget`); `undefined`, nothing rendered, with no fraction asked. */
export async function residentBudget(
  explorer: MeasuredWorld,
  pose: CameraPose,
  fraction: number | undefined,
  settle: (explorer: MeasuredWorld, pose: CameraPose) => Promise<unknown>,
) {
  if (fraction === undefined) return undefined;
  await settle(explorer, pose);
  const bytes = explorer.render(pose).textureResidentBytes ?? undefined;
  await explorer.flush();
  return { bytes, budget: residentFractionBudget(fraction, bytes) };
}
