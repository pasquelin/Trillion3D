import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { openMeasuredWorld, type MeasuredWorld } from '../session/explorer.ts';
import { buildWorldSource } from './worldSource.ts';
import { createRequestLoop } from './requestLoop.ts';
import { createWorldContents } from './worldContents.ts';
import { releaseWorldMirror } from './worldMirror.ts';
import { createWorldMounts } from './worldMounts.ts';
import { createWorldLights } from './worldLights.ts';
import { createWorldLink } from './worldLink.ts';
import { createWorldBackground } from './worldBackground.ts';
import { watchFirstFrame } from '../session/openWatch.ts';
import { worldReopens } from './worldReopen.ts';
import { createCanvasFit, followPageCamera } from './worldCamera.ts';
import type { PosedTwin } from './worldPoses.ts';
import { poseNamed } from '../../host/world/moveByName.ts';
import type { WorldRuntimeInputs as Inputs } from './worldRuntimeInputs.ts';

/** The session drawing a world, fed by a per-frame change list: what the scene asks is resolved
 *  off the frame (`worldContents.ts`), applied once before each frame — rows taken, parked or grown
 *  (`placement/growth.ts`), resources mounted (`worldMounts.ts`), poses, background —, and opened
 *  again once per burst for what it lacks: a model, or what its engine cannot take in place. */
export function createWorldRuntime(inputs: Inputs) {
  const { canvas, scene, camera, open = openMeasuredWorld } = inputs;
  const contents = createWorldContents(scene, inputs.diagnostic.notices),
    lights = createWorldLights(),
    background = createWorldBackground(scene);
  const { poses, cuts } = contents;
  const placeCamera = followPageCamera(camera, canvas);
  const track = worldReopens(canvas, inputs.diagnostic.notices, () => reopens.request()),
    { request } = track;
  let explorer: MeasuredWorld | null = null,
    mirror: NonNullable<ReturnType<typeof buildWorldSource>> | null = null,
    twins = new Map<Object3D, PosedTwin>(),
    resolving: Promise<void> | null = null,
    structureChanged = false,
    seatWanted = false,
    lightsChanged = true,
    disposed = false,
    /** Why no session is open: the first-frame watch says it on the console. */
    closed = 'the scene has not been read yet';
  const invalidate = () => explorer?.invalidate();
  /** A move by name through the session (#972): the page's node the name index finds, posed as
   *  the engines pose theirs, is written as a page write is — its rows, before the next frame. */
  const moveNamed = (nodeName: string, matrix: Float32Array) => {
    const node = poseNamed(scene, nodeName, matrix);
    if (node) poses.moved(node);
    invalidate();
  };
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
    const release = mounts.opening(plan.batches);
    track.closing(explorer);
    explorer?.dispose();
    if (mirror) releaseWorldMirror(mirror.root);
    explorer = mirror = null;
    fit.reset();
    release();
    twins = (built?.twins ?? new Map()) as Map<Object3D, PosedTwin>;
    for (const [node, twin] of twins) poses.writeTwin(node, twin, contents.shown(node));
    lights.reset();
    lightsChanged = true;
    inputs.diagnostic.opening();
    if (!built) {
      closed = 'nothing to draw: the scene holds no mesh and no loaded model';
      return track.none();
    }
    mirror = built;
    try {
      const scope = built.source.metadata.scope; // its first model's scope, or the default
      await inputs.ready(); // a lost device is asked again: it opens on what is granted, or fails
      const options = track.options({ ...inputs.options(), scope });
      // The first frame is read for the page's camera, not a framing one (`prepare.ts`).
      explorer = await open(canvas, options, { ...built.source, placeCamera, moveNamed });
    } catch (error) {
      closed = 'its session failed to open';
      if (!disposed) inputs.diagnostic.failed(error); // cut short by disposal, it failed nothing
      return track.none();
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
  const mounts = createWorldMounts(contents, () => explorer, schedule, track.asks('mount-refused'));
  const backgroundRefused = track.asks('background');
  /** The change list, applied once before a frame: rows seated, poses written, lights stored. */
  const apply = () => {
    const session = explorer;
    if (seatWanted) {
      seatWanted = false;
      contents.seat(session?.growsPlacements() ? session : undefined);
      if (session && mirror) mounts.apply(mirror, session);
      if (contents.reopenNeeded() || (!session && !reopens.running)) request('scene-change');
      // Values or pictures alone repaint the built surface (#335, #362, #572); a reopened one is new.
      const painted = contents.repainted(),
        open = explorer === session ? session : null;
      if (painted.length && mirror && !mirror.repaint(painted, open?.refreshMaterials.bind(open)))
        request('repaint-refused');
    }
    if (!session || explorer !== session) return;
    if (poses.pending)
      poses.apply(scene, contents.seats, twins, (rows, from, to) =>
        session.updatePlacements(rows, from, to),
      );
    if (lightsChanged)
      session.setEnvironment({ ...inputs.display(), irradiance: lights.sync(scene, session) });
    lightsChanged = false;
    background.write(session, backgroundRefused);
  };
  const fit = createCanvasFit(canvas, inputs.options().interactive === false);
  const beforeFrame = () => {
    apply();
    if (!explorer) return;
    fit.apply(explorer);
    placeCamera(explorer.camera);
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
    /** A session option changed, or the device was lost: the next opening takes it. */
    renew: request,
    /** Settles once `session` has closed: what waited on it carries on with the next one. */
    ended: track.ended,
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
      beforeFrame(); // what it applies may close the session: that frame has no image
      if (!explorer) return null;
      const metrics = explorer.render();
      track.drew();
      inputs.frame(metrics);
      return metrics;
    },
    dispose() {
      disposed = true;
      explorer?.dispose();
      track.dispose(explorer);
      if (mirror) releaseWorldMirror(mirror.root);
      cuts.dispose();
      scene.traverse((node) => (node._link = null));
    },
  };
}
