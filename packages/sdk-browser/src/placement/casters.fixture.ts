// #1233 step B1: the CPU caster pipeline over a lit scene of repeated placements. `selectCpuCasters`
// selects each light face FROM THE LIGHT through the same cut, marking the camera-visible casters
// and the pages two faces share; `writeCpuCasters` turns the packed ranks it published into row
// words. This is the fixture the equivalence test drives, over the real runtime of
// `webgpuGrowth.fixture.ts`; only the shadow atlas is short-circuited — the plan is declared done,
// so the two functions the issue names run whole.
import { sunRun } from '../webgpu/shadow/runs.fixture.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { ShadowRuns } from '../webgpu/shadow/runs.ts';

/** The sun the caster cut selects from: one casting directional light. */
const SUN = {
  id: 'sun',
  kind: 'directional' as const,
  direction: [0, -1, 0] as [number, number, number],
  color: [1, 1, 1] as [number, number, number],
  intensity: 1,
  castsShadow: true,
};

/** Two light faces wide enough to see the whole scene (the repeated leaves sit at y ≈ 9..13), the
 *  second at a shifted origin: the pages both see are shared and the dedup path is exercised. */
function faces(): ShadowRuns {
  const first = sunRun(1024, [0, 0, 0], [0, 7, 0, 7], 16),
    second = sunRun(1024, [0.5, 0, 0], [0, 7, 0, 7], 16);
  return { list: [first, second], count: 2 } as unknown as ShadowRuns;
}

/** One page is admitted for the frame; `batchEnd` closes the single batch at it, `reset` is what
 *  the plan's own `reset` calls at dispose. */
const ADMISSION = { count: 1, batchEnd: () => 1, list: new Int32Array(4), reset() {} };

type Services = { shadowTier: unknown };

/**
 * Arms the runtime's light state for the CPU caster cut and returns the closure that puts it back,
 * so the CPU render path keeps no-op'ing on its `cull === undefined` between calls. The shadow
 * atlas is short-circuited: the plan is declared done for the frame (`plannedFrame`) and the batch
 * already composed (`packedBatch`), so `writeShadowPages` returns before touching the atlas and the
 * runs below stand. The cut then runs `selectCpuCasters` over them for real.
 */
export function armCasters(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    services = rt.services as unknown as Services,
    saved = {
      cull: lights.cull,
      runs: lights.runs,
      plannedFrame: lights.plannedFrame,
      plannedView: lights.plannedView,
      admission: lights.plan.admission,
      packedBatch: lights.packedBatch,
      shadowTier: services.shadowTier,
    },
    added = !lights.store.count;
  if (added) lights.store.add(SUN);
  lights.cull = { dispose() {} } as never;
  lights.plannedFrame = rt.run.frame;
  lights.plannedView = rt.views?.active;
  lights.runs = faces();
  lights.plan.admission = ADMISSION as never;
  lights.packedBatch = { frame: rt.run.frame, from: 0, to: 1 };
  // The casters' lower tier is not what this fixture measures: the real one would walk residency
  // sets the CPU frame did not publish. The two functions under test still run whole.
  services.shadowTier = { offerPages() {} };
  return () => {
    if (added) lights.store.remove(SUN.id);
    lights.cull = saved.cull;
    lights.runs = saved.runs;
    lights.plannedFrame = saved.plannedFrame;
    lights.plannedView = saved.plannedView;
    lights.plan.admission = saved.admission;
    lights.packedBatch = saved.packedBatch;
    services.shadowTier = saved.shadowTier;
  };
}
