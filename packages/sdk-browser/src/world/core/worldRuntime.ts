import type { FrameMetrics, SceneToneMapping } from '../../../../sdk-core/src/index.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D, SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { openMeasuredWorld, type MeasuredWorld } from '../session/explorer.ts';
import type { MeasuredWorldOptions } from '../session/options.ts';
import { buildWorldSource } from './worldSource.ts';
import { createWorldContents } from './worldContents.ts';
import { releaseWorldMirror } from './worldMirror.ts';
import { createWorldLights, isLight, lightsUnder } from './worldLights.ts';
import { copyWorldCamera, createCanvasFit } from './worldCamera.ts';
import type { Cut } from './worldCuts.ts';
import type { PosedTwin } from './worldPoses.ts';
import type { Scene } from './scene.ts';
import type { WorldNotices } from '../diagnostic/worldNotices.ts';

type Inputs = {
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: () => Camera;
  /** The session options of the moment: renderer, pools, loop and hooks. */
  options: () => MeasuredWorldOptions;
  /** Runs on every new session, before its first frame: diagnostic mode, pools. */
  opened: (explorer: MeasuredWorld) => void;
  frame: (metrics: FrameMetrics) => void;
  /** The display chain the page set: exposure and curve; the lights add their irradiance. */
  display: () => { exposure: number; toneMapping: SceneToneMapping };
  /** Settles once the world's renderer — and its device — is granted. */
  ready: Promise<unknown>;
  /** A session that could not open: the world reports it, and keeps the scene. */
  failed: (error: unknown) => void;
  notices: WorldNotices;
};

/**
 * The session drawing a world, fed by a per-frame change list. What the scene asks is resolved off
 * the frame into tables — resources, material entries, batches and their rows (`worldContents.ts`)
 * — and applied once before each frame: a mesh added or removed takes or parks a row, a full buffer
 * grows in place (`placement/growth.ts`), a pose writes its row, the session reads the rows in place.
 * It is opened again, on the world's same device and once for a burst of changes, only for what it
 * does not hold: a resource or material entry it never had, rows it cannot grow, a model.
 */
export function createWorldRuntime(inputs: Inputs) {
  const { canvas, scene, camera } = inputs;
  const contents = createWorldContents(scene, inputs.notices),
    lights = createWorldLights();
  const { poses, cuts } = contents;
  let explorer: MeasuredWorld | null = null,
    mirror: NonNullable<ReturnType<typeof buildWorldSource>>['root'] | null = null,
    twins = new Map<Object3D, PosedTwin>(),
    heldCuts = new Set<Cut>(),
    resolving: Promise<void> | null = null,
    reopening: Promise<void> | null = null,
    structureChanged = false,
    seatWanted = false,
    renewWanted = false,
    lightsChanged = true,
    disposed = false;
  const invalidate = () => explorer?.invalidate();
  const relight = () => {
    lightsChanged = true;
    invalidate();
  };
  const reopen = async () => {
    while (renewWanted && !disposed) {
      renewWanted = false;
      // What was resolved since the last frame opens with this session, not with the next one.
      if (seatWanted) {
        seatWanted = false;
        contents.seat();
      }
      const plan = contents.plan();
      const built = buildWorldSource(plan);
      const held = new Set(plan.batches.map((item) => item.cut));
      for (const cut of held) cuts.hold(cut, true);
      explorer?.dispose();
      if (mirror) releaseWorldMirror(mirror);
      explorer = mirror = null;
      fit.reset();
      for (const cut of heldCuts) if (!held.has(cut)) cuts.hold(cut, false);
      heldCuts = held;
      twins = (built?.twins ?? new Map()) as Map<Object3D, PosedTwin>;
      for (const [node, twin] of twins) poses.writeTwin(node, twin, contents.shown(node));
      lights.reset();
      lightsChanged = true;
      if (!built) continue;
      mirror = built.root;
      try {
        // The session reads at the scope its first model was read at, or the default.
        const scope = built.source.metadata.scope;
        explorer = await openMeasuredWorld(canvas, { ...inputs.options(), scope }, built.source);
      } catch (error) {
        if (!disposed) inputs.failed(error); // cut short by disposal, it failed nothing
        continue;
      }
      if (disposed) explorer.dispose();
      else {
        explorer.setLightingView('lit');
        inputs.opened(explorer);
        invalidate();
      }
    }
    reopening = null;
  };
  const requestReopen = () => {
    renewWanted = true;
    reopening ??= reopen();
  };
  // Every change made before the renderer is granted, and while a resolution runs, is folded
  // into the next resolution: one for the burst, never one per call.
  const resolve = async () => {
    while ((structureChanged || contents.staleCount) && !disposed) {
      structureChanged = false;
      if (await contents.resolve()) lightsChanged = true;
      seatWanted = true;
      if (!explorer && !reopening) apply();
      invalidate();
    }
    resolving = null;
  };
  const schedule = () => {
    structureChanged = true;
    resolving ??= inputs.ready.then(resolve, resolve);
  };
  /** The change list, applied once before a frame: rows seated, poses written, lights stored. */
  const apply = () => {
    const session = explorer;
    if (seatWanted) {
      seatWanted = false;
      contents.seat(session?.growsPlacements() ? session.growPlacements : undefined);
      if (contents.reopenNeeded() || (!session && !reopening)) requestReopen();
    }
    if (!session) return;
    if (poses.pending)
      poses.apply(scene, contents.seats, twins, (rows, from, to) =>
        session.updatePlacements(rows, from, to),
      );
    if (lightsChanged) {
      const irradiance = lights.sync(scene, session);
      session.setEnvironment({ ...inputs.display(), irradiance });
      lightsChanged = false;
    }
  };
  const fit = createCanvasFit(canvas, inputs.options().interactive === false);
  const beforeFrame = () => {
    apply();
    if (!explorer) return;
    fit.apply(explorer);
    copyWorldCamera(camera(), explorer.camera, canvas.width / Math.max(1, canvas.height));
  };
  const link: SceneLink = {
    pose(node: Object3D) {
      poses.moved(node);
      if (!isLight(node) || node.children.length) lights.boundsMoved();
      if (lights.held && lightsUnder(node)) lightsChanged = true;
      invalidate();
    },
    structure(parent: Object3D) {
      contents.changed(parent);
      lights.boundsMoved();
      schedule();
    },
    content(node: Object3D) {
      if (isLight(node)) return relight();
      contents.stale(node as Mesh);
      lights.boundsMoved();
      schedule();
    },
  };
  scene._link = link;
  return {
    beforeFrame,
    invalidate,
    /** A session option changed: the next opening takes it, whatever the scene holds. */
    renew: requestReopen,
    /** Exposure or curve changed: written with the lights before the next frame. */
    displayChanged: relight,
    get explorer() {
      return explorer;
    },
    /** Settles once the session reflects every change made so far. */
    async settled() {
      while (resolving || reopening) await (resolving ?? reopening);
    },
    render() {
      if (!explorer) return null;
      beforeFrame();
      const metrics = explorer.render();
      inputs.frame(metrics);
      return metrics;
    },
    dispose() {
      disposed = true;
      explorer?.dispose();
      if (mirror) releaseWorldMirror(mirror);
      cuts.dispose();
      scene._link = null;
    },
  };
}
