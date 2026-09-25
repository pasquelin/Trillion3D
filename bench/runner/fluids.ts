// The fluids bench scene (#418): one ocean, 100 floating bodies, 20 fires and 5 smoke volumes,
// declared here and built in the page through the public API (`fluidsPage.ts`), on WebGPU or
// WebGL2 (`--moteur webgpu|webgl2`), with `--scene fluids`.
//
// The ocean's waves and the bodies are the physics fixtures (`OCEAN`, `floatingBodies`). What the
// engine does not draw yet is a THROWAWAY STAND-IN, named as such: the drawn ocean is a flat
// transmissive sheet at the rest level (#422 draws the waves), a fire is a point light over an
// emissive cone (#423), a smoke volume nested see-through spheres (#423).
//
// Refraction source: the engine reads one only, a copy of the lit image (the WebGPU water pass's
// backdrop, the WebGL2 cluster program's second opaque pass); no path reads the temporal
// antialiasing history, so the scene has no switch between the two.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { WaterSpec } from '../../packages/sdk-core/src/fluids/index.ts';
import { SHAPE, type BodyRecord } from '../../packages/sdk-core/src/physics/index.ts';
import type {
  PhysicsPrimitive,
  PhysicsShape,
} from '../../packages/sdk-core/src/physics/options.ts';
import { OCEAN } from '../../packages/sdk-core/src/fluids/waves.fixture.ts';
import { floatingBodies } from '../../packages/sdk-browser/src/physics/water.fixture.ts';
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts';
import type { Capture } from '../../tests/kit/server/staticServer.ts';
import { distribution } from './summary.ts';
import { passesGpu } from './seriesPasses.ts';
import { p50p95 } from './summaryPasses.ts';
import { sdkEntryUrl } from './dists.ts';
import type { Side } from './sideOptions.ts';
import type { BenchSettings } from './options.ts';
import type * as FluidsPage from './fluidsPage.ts';

type Vec3 = [number, number, number];

/** How many of each the scene holds. */
export const FLUIDS_COUNTS = { oceans: 1, bodies: 100, fires: 20, smokes: 5 } as const;

/** A floating body as the public API takes it: a mesh at `position` with `physics` set. */
export interface FloatingBody {
  position: Vec3;
  density: number;
  shape: PhysicsShape;
}

/** What the page builds: the water, the bodies, and where the stand-ins stand. */
export interface FluidsScene {
  water: WaterSpec;
  bodies: FloatingBody[];
  fires: Vec3[];
  smokes: Vec3[];
}

const primitive = (shape: number, size: readonly number[]): PhysicsPrimitive => {
  if (shape === SHAPE.sphere) return { type: 'sphere', radius: size[0] };
  if (shape === SHAPE.box) return { type: 'box', halfExtents: [size[0], size[1], size[2]] };
  throw new Error(`fluids scene: no public shape for ${shape}`);
};

/** A fixture body's shape in the public API's words: box, sphere, or a compound of them. */
const publicShape = (body: BodyRecord): PhysicsShape =>
  body.shape === SHAPE.compound
    ? {
        type: 'compound',
        parts: (body.parts ?? []).map((part) => ({
          ...primitive(part.shape, part.size),
          position: [part.position[0], part.position[1], part.position[2]],
        })),
      }
    : primitive(body.shape, body.size);

/** The scene, the same every run: the fixtures' bodies and waves, stand-ins over the same grid. */
export function fluidsScene(): FluidsScene {
  const bodies = floatingBodies(FLUIDS_COUNTS.bodies).map((body) => ({
    position: [body.position[0], body.position[1], body.position[2]] as Vec3,
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

/** What one side sends into the page. */
export interface FluidsPayload {
  sdkUrl: string;
  renderer: 'webgpu' | 'webgl2';
  frames: number;
  warmup: number;
  width: number;
  height: number;
  temporalAntialiasing: boolean;
  captureFile: string;
  scene: FluidsScene;
}

const RENDERERS: Record<string, FluidsPayload['renderer']> = {
  'webgpu-page-raster': 'webgpu',
  'autonomous-pages-webgl': 'webgl2',
};

/** One side on the fluids scene: its page run, its capture written, its report row. */
export async function runFluids(
  page: Page,
  side: Side,
  settings: BenchSettings,
  out: string,
  captures: Map<string, Capture>,
) {
  const renderer = RENDERERS[side.engine.id];
  if (!renderer) throw new Error('--scene fluids draws on --moteur webgpu or webgl2 only');
  const payload: FluidsPayload = {
    sdkUrl: sdkEntryUrl(side),
    renderer,
    frames: settings.frames,
    warmup: settings.warmup,
    width: settings.width,
    height: settings.height,
    temporalAntialiasing: settings.temporalAntialiasing,
    captureFile: `${side.name}-fluids.png`,
    scene: fluidsScene(),
  };
  const result = await page.evaluate(
    async ({ module, o }) => ((await import(module)) as typeof FluidsPage).measureFluids(o),
    { module: '/runner/fluidsPage.ts', o: payload },
  );
  if ('erreur' in result) throw new Error(`${side.name} fluids: ${result.erreur}`);
  const capture = captures.get(payload.captureFile);
  if (capture)
    await writeFile(join(out, payload.captureFile), encodePng(capture.w, capture.h, capture.body));
  return {
    side: side.name,
    renderer,
    counts: FLUIDS_COUNTS,
    bodiesSimulated: result.bodies,
    cpuFrameMs: distribution(result.cpuFrameMs),
    gpuFrameMs: result.gpuFrameMs.length ? distribution(result.gpuFrameMs) : null,
    rafIntervalMs: distribution(result.rafIntervalMs),
    passesGpu: passesGpu(result.gpuPassSamples),
    physicsStepMs: distribution(result.physicsStepMs),
    physicsMainMs: distribution(result.physicsMainMs),
    canvas: result.size,
    png: capture ? payload.captureFile : null,
  };
}

export type FluidsRow = Awaited<ReturnType<typeof runFluids>>;

/** The fluids rows in `resume.md`, p50 / p95 in milliseconds; nothing without a fluids run. */
export function fluidsLines(rows: FluidsRow[] | undefined) {
  if (!rows?.length) return [];
  return [
    '## Fluids scene',
    '',
    `${FLUIDS_COUNTS.bodies} bodies, ${FLUIDS_COUNTS.fires} fire and ${FLUIDS_COUNTS.smokes} smoke stand-ins, one ocean stand-in.`,
    '',
    '| side | renderer | canvas | bodies | CPU frame | GPU frame | rAF interval | physics step (worker) | physics (page) |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.side} | ${r.renderer} | ${r.canvas.width}×${r.canvas.height} @${r.canvas.dpr} | ${r.bodiesSimulated} | ` +
        `${p50p95(r.cpuFrameMs)} | ${p50p95(r.gpuFrameMs)} | ${p50p95(r.rafIntervalMs)} | ` +
        `${p50p95(r.physicsStepMs)} | ${p50p95(r.physicsMainMs)} |`,
    ),
    '',
  ];
}
