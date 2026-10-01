import { worldReleases } from './worldRelease.ts';
import { createViewMask } from '../views/mask.ts';
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
import { namedMove } from './worldSceneMethods.ts';
import type { WorldRuntimeInputs as Inputs } from './worldRuntimeInputs.ts';
import { DYNAMIC_UPLOAD_BUDGET_BYTES } from './worldDynamic.ts';
import { vertexUploads } from './worldDynamicRanges.ts';
/** Applies scene changes in place before rendering; reopens only when the engine cannot. */
export function createWorldRuntime(inputs: Inputs) {
  const { canvas, scene, camera, open = openMeasuredWorld } = inputs;
  const releases = worldReleases();
  const contents = createWorldContents(scene, inputs.diagnostic.notices),
    lights = createWorldLights(),
    background = createWorldBackground(scene);
  const { poses, cuts } = contents;
  const placeCamera = followPageCamera(camera, canvas);
  const track = worldReopens(canvas, inputs.diagnostic.notices, () => reopens.request());
  let explorer: MeasuredWorld | null = null,
    mirror: NonNullable<ReturnType<typeof buildWorldSource>> | null = null,
    twins = new Map<Object3D, PosedTwin>(),
    resolving: Promise<void> | null = null,
    structureChanged = false,
    seatWanted = false,
    lightsChanged = true,
    disposed = false,
    closed = 'the scene has not been read yet';
  const invalidate = () => explorer?.invalidate();
  const moveNamed = namedMove(scene, poses, invalidate);
  const relight = () => ((lightsChanged = true), invalidate());
  const reopen = async () => {
    if (disposed) return;
    closed = 'its session is opening';
    if (seatWanted) contents.seat();
    seatWanted = false;
    const plan = contents.plan();
    const built = buildWorldSource(plan);
    const release = mounts.opening(plan.batches);
    inputs.closingViews?.();
    track.closing(explorer);
    const previous = releases.close(explorer, mirror);
    explorer = mirror = null;
    await previous;
    release();
    if (disposed) {
      if (built) releaseWorldMirror(built.root);
      return;
    }
    fit.reset();
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
      const scope = built.source.metadata.scope;
      await inputs.ready(); // a lost device is asked again: it opens on what is granted, or fails
      const given = inputs.options();
      const onFrame: typeof given.onFrame = (m) => (cuts.dynamic.drew(m), given.onFrame?.(m));
      const options = track.options({ ...given, scope, onFrame });
      explorer = await open(canvas, options, { ...built.source, placeCamera, moveNamed });
    } catch (error) {
      closed = 'its session failed to open';
      if (!disposed) inputs.diagnostic.failed(error); // cut short by disposal, it failed nothing
      return track.none();
    }
    if (disposed) return releases.close(explorer);
    explorer.setLightingView('lit');
    invalidate();
    await Promise.resolve()
      .then(() => inputs.opened(explorer!))
      .catch(inputs.diagnostic.failed);
  };
  const reopens = createRequestLoop(reopen);
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
  const uploads = vertexUploads(
    () => explorer,
    (cut) => mirror?.geometryOf(cut),
    track.asks('vertices-refused'),
  );
  const apply = () => {
    const session = explorer;
    if (seatWanted) {
      seatWanted = false;
      contents.seat(session?.growsPlacements() ? session : undefined);
      if (session && mirror) mounts.apply(mirror, session);
      if (contents.reopenNeeded() || (!session && !reopens.running)) track.request('scene-change');
      const painted = contents.repainted(),
        open = explorer === session ? session : null;
      if (painted.length && mirror && !mirror.repaint(painted, open?.refreshMaterials.bind(open)))
        track.request('repaint-refused');
    }
    if (!session || explorer !== session) return;
    cuts.dynamic.upload(DYNAMIC_UPLOAD_BUDGET_BYTES, uploads);
    if (poses.pending)
      poses.apply(scene, contents.seats, twins, (rows, from, to) =>
        session.updatePlacements(rows, from, to),
      );
    if (lightsChanged)
      session.setEnvironment({ ...inputs.display(), irradiance: lights.sync(scene, session) });
    lightsChanged = false;
    background.write(session, backgroundRefused);
  };
  const withViewMask = createViewMask(
    scene,
    contents.seats,
    () => twins,
    (rows, from, to) => explorer?.updatePlacements(rows, from, to),
    () => explorer?.views.checkMask(),
  );
  const fit = createCanvasFit(canvas, inputs.options().interactive === false);
  const beforeFrame = () => {
    if (disposed) return;
    apply();
    if (!explorer) return;
    fit.apply(explorer);
    placeCamera(explorer.camera);
    inputs.followViews?.();
  };
  watchFirstFrame(() => {
    if (inputs.drawn() || disposed || !scene.children.length) return null;
    return explorer ? 'its session is open and draws nothing' : `no session has opened, ${closed}`;
  });
  scene._link = createWorldLink({ contents, lights, invalidate, relight, schedule });
  return {
    beforeFrame,
    withViewMask,
    invalidate,
    moveNamed,
    renew: track.request,
    ended: track.ended,
    displayChanged: relight,
    get explorer() {
      return explorer;
    },
    async settled() {
      while (resolving || reopens.running) await (resolving ?? reopens.running);
      await explorer?.familiesPending();
    },
    render(ahead?: () => void) {
      if (disposed || !explorer || explorer.familiesPending()) return null;
      ahead?.();
      beforeFrame(); // what it applies may close the session: that frame has no image
      if (!explorer) return null;
      const metrics = explorer.render();
      cuts.dynamic.drew(metrics);
      track.drew();
      inputs.frame(metrics);
      return metrics;
    },
    dispose() {
      disposed = true;
      inputs.closingViews?.();
      void releases.close(explorer);
      track.dispose(explorer);
      cuts.dispose();
      scene.traverse((node) => (node._link = null));
      return releases.drain(mirror, resolving, reopens.running);
    },
  };
}
