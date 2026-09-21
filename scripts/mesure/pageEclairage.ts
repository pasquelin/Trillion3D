import type * as SdkBrowser from '../../packages/sdk-browser/index.ts';
import type { MeasureViewOptions, MeasureViewResult } from './mesureOptions.ts';
import type * as PageCoupe from './pageCoupe.ts';
import type * as PageTemoin from './pageTemoin.ts';
import type * as PageExplorateur from './pageExplorateur.ts';
import type * as PageMesure from './pageMesure.ts';
import type { GpuPassTimings } from '../../packages/sdk-core/index.ts';
import type { MovingNode } from './report/types.ts';

/** One view, one side, one threshold: durations of each frame, the selected cut, the capture. */
// Named by its backend export at build time (`exactPagesBackend`, `webgpuPagesBackend`,
// `autonomousPagesBackend`), by whatever name a test double exports otherwise: the lookup below
// is a plain dynamic index by design, so the namespace type carries the same index signature.
type SdkNamespace = typeof SdkBrowser & Record<string, SdkBrowser.BackendFactory | undefined>;

export async function measureView(options: MeasureViewOptions): Promise<MeasureViewResult> {
  const sdk = (await import(options.sdkUrl)) as SdkNamespace;
  const coupe = (await import(`${options.modulesUrl}pageCoupe.ts`)) as typeof PageCoupe;
  // The Three witness does not read the contract's light store: the harness, a host like any
  // other, itself places in Three the lights that store declares (`pageTemoin.ts`).
  const lighting = options.witness
    ? (
        (await import(`${options.modulesUrl}pageTemoin.ts`)) as typeof PageTemoin
      ).creerEclairageTemoin()
    : null;
  const factory = options.backend ? sdk[options.backend] : undefined;
  if (!factory) return { erreur: `engine missing from dist: ${options.backend}` };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  // What the GPU reported — lost WebGL context, uncaptured error, lost device — published on
  // the page as it happens: a failing frame carries its call stack, never the cause, and the
  // bench comes looking for it there.
  const lost: string[] = (globalThis.incidentsGpu = []);
  canvas.addEventListener('webglcontextlost', () => lost.push('webglcontextlost'), false);
  const reglages = (await import(
    `${options.modulesUrl}pageExplorateur.ts`
  )) as typeof PageExplorateur;
  const mesure = (await import(`${options.modulesUrl}pageMesure.ts`)) as typeof PageMesure;
  // Preparation, timed from the call to the return, and what it transferred on the network:
  // resources the page already loaded are not counted, only those after.
  const preparationStart = performance.now();
  // The resource-timing buffer overflows at 250 by default; a scene loads tens of thousands,
  // and a full buffer stops recording without a word.
  performance.setResourceTimingBufferSize(1_000_000);
  const resourcesBefore = performance.getEntriesByType('resource').length;
  const diagnostics = mesure.collecteDiagnostics(lost);
  const explorer = await sdk.createExplorer(canvas, {
    onDiagnostic: diagnostics.onDiagnostic,
    ...reglages.explorerOptions(options, factory, lighting),
  });
  const preparationMs = performance.now() - preparationStart;
  // What the file brought, before any bench addition. A dist older than the light-import
  // batch has no such function: the measurement returns `null`, never an invented count.
  const declared = typeof explorer.importedLights === 'function' ? explorer.importedLights() : null;
  const importedLights = declared
    ? { nombre: declared.length, ids: declared.map((light) => light.id) }
    : null;
  // Contract lights, placed by the harness's generic rule and passed here as data: the
  // page computes no position and invents no scene.
  for (const light of options.lights ?? []) explorer.addLight(light);
  // The same lights, in Three, for the witness: read from the store, never placed by hand.
  const witnessLights = lighting ? lighting.suivre(explorer) : null;
  const moving = options.moving;
  // A moving light: a small circle, applied before each measured frame.
  const moveLight = (frame: number) => {
    if (!moving) return;
    explorer.setLight(moving.id, { position: mesure.positionLampeMobile(moving, frame) });
    lighting?.suivre(explorer);
  };
  const pose = options.pose;
  // A moving object: the node named by the host walks a small circle. The first call places
  // it at the world origin — one large jump, once — then later steps are small, the very
  // case page invalidation handles. A missing name is recorded, never dropped.
  const node = options.movingNode;
  let movingNode: MovingNode = null;
  const moveNode = (frame: number) => {
    if (!node || (movingNode && 'erreur' in movingNode)) return;
    const angle = (frame / 30) * Math.PI * 2,
      r = options.movingNodeRadius ?? 1;
    const matrix = new Float32Array(16);
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
    matrix[12] = Math.cos(angle) * r;
    matrix[14] = Math.sin(angle) * r;
    try {
      explorer.setTransform(node, matrix);
      const previousImages = movingNode && 'images' in movingNode ? movingNode.images : 0;
      movingNode = { noeud: node, rayon: r, images: previousImages + 1 };
    } catch (error) {
      movingNode = { noeud: node, erreur: String(error) };
    }
  };
  const poses = options.poses;
  // The last rendered pose, the one the shadow-queue drain replays: the capture that follows
  // is then exactly that of previous batches. One pose per frame when the camera moves.
  let current = pose;
  const poseAt = (frame: number) => {
    current = poses ? poses[frame % poses.length] : pose;
    return current;
  };
  explorer.setPose(pose);
  // Bounded warmup: the cut resides before anything is recorded.
  for (let i = 0; i < options.warmup; i++) {
    await explorer.awaitPages();
    explorer.render(pose);
    await explorer.flush();
  }
  // In-session reservoir tuning, if requested, is measured on the already-resident cut.
  const reglageVivant = await mesure.reglerReservoirs(explorer, pose, options.poolVivant);
  const cpuFrameMs: number[] = [],
    cpuSelectMs: number[] = [],
    gpuFrameMs: number[] = [],
    rafIntervalMs: number[] = [];
  const gpuPassSamples: GpuPassTimings[] = [];
  const profileStart = Math.max(0, options.frames - options.profileFrames);
  let last: ReturnType<typeof explorer.render> | null = null,
    previousRaf: number | null = null;
  for (let i = 0; i < options.frames; i++) {
    if (options.stageProfile && i === profileStart) explorer.resetStageProfile();
    const now = await new Promise<number>((done) => requestAnimationFrame(done));
    if (previousRaf !== null && i > 2) rafIntervalMs.push(now - previousRaf);
    previousRaf = now;
    moveLight(i);
    moveNode(i);
    last = explorer.render(poseAt(i));
    if (typeof last.cpuFrameMs === 'number') cpuFrameMs.push(last.cpuFrameMs);
    if (typeof last.cpuSelectMs === 'number') cpuSelectMs.push(last.cpuSelectMs);
    if (typeof last.gpuFrameMs === 'number') gpuFrameMs.push(last.gpuFrameMs);
    const sample = last.gpuPassMs;
    if (i >= profileStart && sample && sample.frame !== gpuPassSamples.at(-1)?.frame)
      gpuPassSamples.push(sample);
  }
  await explorer.flush();
  // Capture freezes the last measured pose. Restarting at poseAt(0) would average a second
  // journey into the A/A witness (#25: still camera 0 px, moving camera leftover on `sol`).
  const capturePose = current;
  const stageProfile = options.stageProfile ? explorer.stageProfile() : null;
  // The engine's CPU bounds over the same window as the stage profile, read once, before the
  // drain and the calm below file images of their own. A dist older than #80 has no such function.
  const bornesCpu =
    options.stageProfile && typeof explorer.cpuSteps === 'function' ? explorer.cpuSteps() : null;
  // The shadow-page queue is drained before any atlas read: see `drainShadowAtlas`.
  const shadowAtlas = options.shadowDigest
    ? await mesure.drainShadowAtlas(explorer, capturePose)
    : null;
  // The capture is that of a HELD pose (`pageMesure.ts`): `imagesCalme` says how many frames
  // it took for the engine to hold it, `null` if it holds no image.
  const imagesCalme = await mesure.poseCalme(explorer, capturePose);
  const response = await mesure.posterCapture(
    options.captureFile,
    explorer.capture(),
    canvas.width,
    canvas.height,
  );
  const selection = coupe.lireCoupe(explorer, options.engineId);
  const metrics = mesure.filtrerMetriques(last);
  // Bytes transferred on the network since preparation, by file kind: what loading and the
  // series actually cost the server, images and texture levels included.
  const network = mesure.reseauDepuis(resourcesBefore);
  const size = { width: canvas.width, height: canvas.height };
  explorer.dispose();
  canvas.remove();
  return {
    cpuFrameMs,
    cpuSelectMs,
    gpuFrameMs,
    rafIntervalMs,
    importedLights,
    lampesTemoin: witnessLights,
    shadowAtlas,
    movingNode,
    stageProfile,
    gpuPassSamples,
    selection,
    metrics,
    preparationMs,
    network,
    imagesCalme,
    reglageVivant,
    mathBatch: last?.mathBatch ?? null,
    size,
    lost,
    // Compiler warnings the engine reported at open; `null` with none.
    avertissementsDag: diagnostics.avertissements,
    bornesCpu,
    captureStatus: response.status,
  };
}
