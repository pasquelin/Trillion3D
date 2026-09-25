// The fluids bench scene (#418), `--scene fluids` on `--moteur webgpu|webgl2`: one ocean, 100
// floating bodies, 20 fires and 5 smoke volumes, declared here and built in the page through the
// public API (`fluidsPage.ts`). The waves and bodies are the physics fixtures (`OCEAN`,
// `floatingBodies`); what the engine does not draw yet is a THROWAWAY STAND-IN: a flat
// transmissive ocean (#422 draws the waves), fires and smoke volumes (#423). The engine has one
// refraction source, a copy of the lit image: the scene has no switch between two.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { SHAPE, type BodyRecord } from '../../packages/sdk-core/src/physics/index.ts';
import type { PhysicsPart, PhysicsPrimitive } from '../../packages/sdk-core/src/physics/options.ts';
import { OCEAN } from '../../packages/sdk-core/src/fluids/waves.fixture.ts';
import { floatingBodies } from '../../packages/sdk-browser/src/physics/water.fixture.ts';
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts';
import type { Capture } from '../../tests/kit/server/staticServer.ts';
import { distribution, machineLoad } from './summary.ts';
import { passesGpu } from './seriesPasses.ts';
import { p50p95, passes } from './summaryPasses.ts';
import { sdkEntryUrl } from './dists.ts';
import { withGpuIncidents } from './seriesPage.ts';
import type { Side } from './sideOptions.ts';
import type { BenchSettings } from './options.ts';
import type * as FluidsPage from './fluidsPage.ts';

type Vec3 = [number, number, number];
const vec3 = (v: ArrayLike<number>) => Array.from(v) as Vec3;

/** How many of each the scene holds, beside its one ocean. */
export const FLUIDS_COUNTS = { bodies: 100, fires: 20, smokes: 5 } as const;

const primitive = (shape: number, size: readonly [number, number, number]): PhysicsPrimitive => {
  if (shape === SHAPE.sphere) return { type: 'sphere', radius: size[0] };
  if (shape === SHAPE.box) return { type: 'box', halfExtents: size };
  throw new Error(`fluids scene: no public shape for ${shape}`);
};

/** A fixture body's shape in the public API's words: box, sphere, or a compound of them. */
const publicShape = (
  body: BodyRecord,
): PhysicsPrimitive | { type: 'compound'; parts: PhysicsPart[] } =>
  body.shape === SHAPE.compound
    ? {
        type: 'compound',
        parts: (body.parts ?? []).map((part) => ({
          ...primitive(part.shape, part.size),
          position: vec3(part.position),
          quaternion: Array.from(part.quaternion) as [number, number, number, number],
        })),
      }
    : primitive(body.shape, body.size);

/** The scene, the same every run: the fixtures' bodies and waves, stand-ins over their grid. */
export function fluidsScene() {
  const bodies = floatingBodies(FLUIDS_COUNTS.bodies).map((body) => ({
    position: vec3(body.position),
    density: body.density,
    shape: publicShape(body),
  }));
  const fires = Array.from({ length: FLUIDS_COUNTS.fires }, (_, i): Vec3 => [
    3 + (i % 5) * 12,
    1.5,
    3 + Math.floor(i / 5) * 16,
  ]);
  const smokes = Array.from({ length: FLUIDS_COUNTS.smokes }, (_, i): Vec3 => [3 + i * 12, 8, 27]);
  return { water: { waves: OCEAN, level: 0 }, bodies, fires, smokes };
}
export type FluidsScene = ReturnType<typeof fluidsScene>;

/** What one side sends into the page: the bench settings are plain data, sent whole. */
function fluidsPayload(side: Side, settings: BenchSettings, scene: FluidsScene) {
  const renderer = side.engine.renderer;
  if (!renderer) throw new Error('--scene fluids draws on --moteur webgpu or webgl2 only');
  return {
    sdkUrl: sdkEntryUrl(side),
    renderer,
    settings,
    captureFile: `${side.name}-fluids.png`,
    scene,
  };
}
export type FluidsPayload = ReturnType<typeof fluidsPayload>;

/** One side on the fluids scene: its page run, its capture written, its report row. */
async function fluidsRow(
  side: string,
  page: Page,
  payload: FluidsPayload,
  out: string,
  captures: Map<string, Capture>,
) {
  const loadAtStart = machineLoad();
  const result = await withGpuIncidents(page, () =>
    page.evaluate(
      async ({ module, o }) => ((await import(module)) as typeof FluidsPage).measureFluids(o),
      { module: '/runner/fluidsPage.ts', o: payload },
    ),
  );
  const capture = captures.get(payload.captureFile);
  if (capture)
    await writeFile(join(out, payload.captureFile), encodePng(capture.w, capture.h, capture.body));
  return {
    side,
    renderer: payload.renderer,
    bodiesSimulated: result.bodies,
    cpuFrameMs: distribution(result.cpuFrameMs),
    gpuFrameMs: distribution(result.gpuFrameMs),
    rafIntervalMs: distribution(result.rafIntervalMs),
    passesGpu: passesGpu(result.gpuPassSamples),
    physicsStepMs: distribution(result.physicsStepMs),
    physicsMainMs: distribution(result.physicsMainMs),
    canvas: result.size,
    png: capture ? payload.captureFile : null,
    charge: { debut: loadAtStart, fin: machineLoad() },
  };
}
export type FluidsRow = Awaited<ReturnType<typeof fluidsRow>>;

/** Every side on the fluids scene, each on a fresh page (`onFreshPage`). */
export async function runFluids(
  sides: Side[],
  onFreshPage: <T>(run: (page: Page) => Promise<T>) => Promise<T>,
  settings: BenchSettings,
  out: string,
  captures: Map<string, Capture>,
) {
  const scene = fluidsScene(),
    rows: FluidsRow[] = [];
  for (const side of sides) {
    const payload = fluidsPayload(side, settings, scene);
    rows.push(await onFreshPage((page) => fluidsRow(side.name, page, payload, out, captures)));
  }
  return rows;
}

/** The fluids rows in `resume.md`, p50 / p95 in milliseconds, then each side's GPU passes and
 *  machine load; nothing without a fluids run. */
export function fluidsLines(rows: FluidsRow[] | undefined) {
  if (!rows?.length) return [];
  return [
    '## Fluids scene',
    '',
    '| side | renderer | canvas | bodies | CPU frame | GPU frame | rAF interval | physics step (worker) | physics (page) |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.side} | ${r.renderer} | ${r.canvas.width}×${r.canvas.height} @${r.canvas.dpr} | ${r.bodiesSimulated} | ` +
        [r.cpuFrameMs, r.gpuFrameMs, r.rafIntervalMs, r.physicsStepMs, r.physicsMainMs]
          .map(p50p95)
          .join(' | ') +
        ' |',
    ),
    '',
    ...rows.flatMap((r) => [
      `### ${r.side}: GPU passes`,
      '',
      ...passes(r.passesGpu),
      `- Machine load at start ${r.charge.debut.join(' ')}, at end ${r.charge.fin.join(' ')}`,
      '',
    ]),
  ];
}
