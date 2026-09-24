import type { FrameMetrics, SceneToneMapping } from '../../../../sdk-core/src/index.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { openMeasuredWorld, type MeasuredWorld } from '../session/explorer.ts';
import type { MeasuredWorldOptions } from '../session/options.ts';
import { buildWorldSource } from './worldSource.ts';
import { createRequestLoop } from './requestLoop.ts';
import { createWorldContents } from './worldContents.ts';
import { releaseWorldMirror } from './worldMirror.ts';
import { createWorldLights } from './worldLights.ts';
import { createWorldLink } from './worldLink.ts';
import { createWorldBackground } from './worldBackground.ts';
import { watchFirstFrame } from '../session/openWatch.ts';
import { copyWorldCamera, createCanvasFit, drawnAspect } from './worldCamera.ts';
import type { Cut } from './worldCuts.ts';
import type { PosedTwin } from './worldPoses.ts';
import type { Scene } from './scene.ts';
import type { worldDiagnostic } from './worldHandles.ts';

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
  /** Whether the world has drawn a frame yet. */
  drawn: () => boolean;
  /** Settles once the world's renderer — and its device — is granted, a lost one asked again. */
  ready: () => Promise<unknown>;
  /** The world's notices; each opening, tried or not; a session or a scene that failed, kept. */
  diagnostic: Pick<ReturnType<typeof worldDiagnostic>, 'notices' | 'failed' | 'opening'>;
  /** Opens a session; stands for the engine's own. */
  open?: typeof openMeasuredWorld;
};

/**
 * The session drawing a world, fed by a per-frame change list. What the scene asks is resolved off
 * the frame (`worldContents.ts`) and applied once before each frame: rows taken, parked or grown in
 * place (`placement/growth.ts`), poses, the background (`worldBackground.ts`). It is opened again,
 * on the world's device, once per burst, only for what it lacks: resource, material, rows, model.
 */
export function createWorldRuntime(inputs: Inputs) {
  const { canvas, scene, camera, open = openMeasuredWorld } = inputs;
  const contents = createWorldContents(scene, inputs.diagnostic.notices),
    lights = createWorldLights(),
    background = createWorldBackground(scene);
  const { poses, cuts } = contents;
  let explorer: MeasuredWorld | null = null,
    mirror: NonNullable<ReturnType<typeof buildWorldSource>> | null = null,
    twins = new Map<Object3D, PosedTwin>(),
    heldCuts = new Set<Cut>(),
    resolving: Promise<void> | null = null,
    structureChanged = false,
    seatWanted = false,
    lightsChanged = true,
    disposed = false,
    /** Why no session is open: the first-frame watch says it on the console. */
    closed = 'the scene has not been read yet';
  const invalidate = () => explorer?.invalidate();
  const relight = () => {
    lightsChanged = true;
    invalidate();
  };
  /** One opening: the session in place closed, the next one opened on what the scene holds. */
  const reopen = async () => {
    if (disposed) return;
    closed = 'its session is opening';
    // What was resolved since the last frame opens with this session, not with the next one.
    if (seatWanted) contents.seat();
    seatWanted = false;
    const plan = contents.plan();
    const built = buildWorldSource(plan);
    const held = new Set(plan.batches.map((item) => item.cut));
    for (const cut of held) cuts.hold(cut, true);
    explorer?.dispose();
    if (mirror) releaseWorldMirror(mirror.root);
    explorer = mirror = null;
    fit.reset();
    for (const cut of heldCuts) if (!held.has(cut)) cuts.hold(cut, false);
    heldCuts = held;
    twins = (built?.twins ?? new Map()) as Map<Object3D, PosedTwin>;
    for (const [node, twin] of twins) poses.writeTwin(node, twin, contents.shown(node));
    lights.reset();
    lightsChanged = true;
    inputs.diagnostic.opening();
    if (!built) {
      closed = 'nothing to draw: the scene holds no mesh and no loaded model';
      return;
    }
    mirror = built;
    try {
      // The session reads at the scope its first model was read at, or the default.
      const scope = built.source.metadata.scope;
      await inputs.ready(); // a lost device is asked again: it opens on what is granted, or fails
      explorer = await open(canvas, { ...inputs.options(), scope }, built.source);
    } catch (error) {
      closed = 'its session failed to open';
      if (!disposed) inputs.diagnostic.failed(error); // cut short by disposal, it failed nothing
      return;
    }
    if (disposed) return explorer.dispose();
    // Lit and a frame asked before the page's own settings: the first image had no lights.
    explorer.setLightingView('lit');
    invalidate();
    inputs.opened(explorer);
  };
  const reopens = createRequestLoop(reopen);
  // Changes before the grant or during a resolution fold into the next; a throw ends the burst.
  const resolve = async () => {
    try {
      while ((structureChanged || contents.staleCount) && !disposed) {
        structureChanged = false;
        if (await contents.resolve()) lightsChanged = true;
        seatWanted = true;
        if (!explorer && !reopens.running) apply();
        invalidate();
      }
    } catch (error) {
      closed = 'the scene could not be resolved';
      lightsChanged = true; // a light taken with the burst that threw is written all the same
      if (!disposed)
        inputs.diagnostic.failed(new Error('World scene resolution failed', { cause: error }));
    }
    resolving = null;
  };
  const schedule = () => {
    structureChanged = true;
    resolving ??= inputs.ready().then(resolve, resolve);
  };
  /** The change list, applied once before a frame: rows seated, poses written, lights stored. */
  const apply = () => {
    const session = explorer;
    if (seatWanted) {
      seatWanted = false;
      contents.seat(session?.growsPlacements() ? session.growPlacements : undefined);
      if (contents.reopenNeeded() || (!session && !reopens.running)) reopens.request();
      // A material written on its values alone repaints the surface already built (#335).
      const painted = contents.repainted().filter((entry) => mirror?.repaint(entry.material));
      // A reopen requested above disposed `session` at once: the next one is built repainted.
      if (painted.length && session && explorer === session && !session.refreshMaterials())
        reopens.request();
    }
    if (!session || explorer !== session) return;
    if (poses.pending)
      poses.apply(scene, contents.seats, twins, (rows, from, to) =>
        session.updatePlacements(rows, from, to),
      );
    if (lightsChanged)
      session.setEnvironment({ ...inputs.display(), irradiance: lights.sync(scene, session) });
    lightsChanged = false;
    background.write(session, reopens.request);
  };
  const fit = createCanvasFit(canvas, inputs.options().interactive === false);
  const beforeFrame = () => {
    apply();
    if (!explorer) return;
    fit.apply(explorer);
    copyWorldCamera(camera(), explorer.camera, drawnAspect(canvas));
  };
  // A scene holding something that has drawn nothing says why, once (`openWatch.ts`).
  watchFirstFrame(() => {
    if (inputs.drawn() || disposed || !scene.children.length) return null;
    return explorer ? 'its session is open and draws nothing' : `no session has opened, ${closed}`;
  });
  scene._link = createWorldLink({ contents, lights, invalidate, relight, schedule });
  return {
    beforeFrame,
    invalidate,
    /** A session option changed: the next opening takes it, whatever the scene holds. */
    renew: reopens.request,
    /** Exposure or curve changed: written with the lights before the next frame. */
    displayChanged: relight,
    get explorer() {
      return explorer;
    },
    /** Settles once the session reflects every change made so far. */
    async settled() {
      while (resolving || reopens.running) await (resolving ?? reopens.running);
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
      if (mirror) releaseWorldMirror(mirror.root);
      cuts.dispose();
      scene._link = null;
    },
  };
}
