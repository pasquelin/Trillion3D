import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';

/** Pages the latest report asked for: those of the pool it named, those it found no page for and
 *  those past its list. Nothing before any report. */
function askedPages(plan: ShadowPlan) {
  const { pool, requests } = plan,
    latest = requests.latest;
  if (latest < 0) return 0;
  let named = 0;
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.requested[page] >= latest) named++;
  return named + requests.counts.refused + requests.counts.unlisted;
}

/** What each light state's pool follows between reports: the last report weighed, whether the
 *  pool holds less than two of them (`ceiling`), whether one asked past it (`full`), and the frame
 *  the view came to rest, −1 while it moves. */
type Ceiling = { latest: number; ceiling: boolean; full: boolean; restFrom: number };
const ceilings = new WeakMap<WebgpuLightState, Ceiling>();
const ceilingOf = (lights: WebgpuLightState) => {
  let held = ceilings.get(lights);
  if (!held)
    ceilings.set(lights, (held = { latest: -1, ceiling: false, full: false, restFrom: -1 }));
  return held;
};

/** The pool full, said once as it comes to be, as Unreal warns of a physical
 *  page pool overflow: what the scene asks past it reads the coarser level (`shadowPagesOverflow`). */
function sayShadowCeiling(rt: WebgpuPagesRuntime, wanted: number) {
  rt.diag.engineDiagnostic(
    'shadow-pool',
    'The shadow pool is full: the pages past it read the coarser level',
    { kind: 'warning', version: 2, wanted, pages: rt.lights.plan.pool.pages, clamp: 'ceiling' },
  );
}

/**
 * THE POOL AT ITS CEILING. The pool keeps the size its setting gave it (`poolSize.ts`), as Unreal
 * keeps `r.Shadow.Virtual.MaxPhysicalPages`: no report resizes it, so no page ever changes place,
 * no static layer is let go and no GPU mapping is left pointing at a page another entry holds
 * (#831). After each report it weighs what the report asked: a pool that holds less than two
 * reports — the one being read and the next — is at its ceiling (`shadowKeptFrom`); a report that
 * asked more than the pool holds is said once, as Unreal warns of a physical page pool overflow,
 * its pages past the pool reading the coarser level (`shadowPagesOverflow`).
 */
export function followShadowCeiling(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    { plan } = lights,
    held = ceilingOf(lights),
    latest = plan.requests.latest;
  if (!lights.shadows?.texture || latest < 0 || latest === held.latest) return;
  held.latest = latest;
  const asked = askedPages(plan),
    full = asked > plan.pool.pages;
  held.ceiling = 2 * asked > plan.pool.pages;
  if (full && !held.full) sayShadowCeiling(rt, asked);
  held.full = full;
}

/**
 * The first frame whose asks no page need of frame `frame` evicts (`allocWgsl.ts`): this one, or,
 * while the pool is at its ceiling and the view rests, the frame it came to rest. The jitter phases
 * of a still view then never take each other's pages: what they ask past the pool is refused and
 * reads the coarser page, and the image rests instead of drawing pages again every frame (#1345).
 */
export function shadowKeptFrom(lights: WebgpuLightState, frame: number) {
  const held = ceilingOf(lights);
  held.restFrom = lights.plan.resting ? (held.restFrom < 0 ? frame : held.restFrom) : -1;
  return held.ceiling && held.restFrom >= 0 ? held.restFrom : frame;
}
