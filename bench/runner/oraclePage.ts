// Executed WITHIN page for oracle campaign. Playwright serializes this function:
// it reads no module variables, receiving everything via its single argument.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';
import type { SceneLight } from '../../packages/sdk-core/src/scene/light/contracts.ts';

/** What `measureIrradiance` needs: SDK and manifest, camera and lights, and the light move
 *  whose reconvergence delay is measured. */
export interface IrradianceOptions {
  sdkUrl: string;
  backend: string | null;
  manifestUrl: string;
  pose: CameraPose;
  captureFile: string;
  width: number;
  height: number;
  pixelError: number;
  maxPages: number;
  exposure: number;
  converge: number;
  delayFrames: number;
  lights: SceneLight[];
  movingLight: string;
  originalPosition: [number, number, number];
  movedPosition: [number, number, number];
}

export type IrradianceResult =
  { erreur: string } | { gaps: number[]; rebond: Record<string, unknown> | null };

/**
 * Converged indirect irradiance of a pose, then convergence delay after a light moves.
 *
 * `bounce` view outputs raw indirect irradiance, multiplied by exposure without ACES or sRGB:
 * this is the quantity computed by the compiler oracle. Delay is measured in frames.
 */
export async function measureIrradiance(options: IrradianceOptions): Promise<IrradianceResult> {
  const sdk = (await import(options.sdkUrl)) as typeof SdkBrowser;
  // Known by literal name, not by a dynamic index: the SDK namespace carries no index signature.
  const backends: Record<string, SdkBrowser.BackendFactory> = {
    exactPagesBackend: sdk.exactPagesBackend,
    webgpuPagesBackend: sdk.webgpuPagesBackend,
    autonomousPagesBackend: sdk.autonomousPagesBackend,
  };
  const factory = options.backend ? backends[options.backend] : undefined;
  if (!factory) return { erreur: `moteur absent du dist : ${options.backend}` };
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  // Engine bounce diagnostic.
  const bounce: Record<string, unknown>[] = [];
  const explorer = await sdk.openMeasuredWorld(canvas, {
    onDiagnostic: (event) => {
      if (event.phase === 'bounce-lighting') bounce.push(event.context);
    },
    manifestUrl: options.manifestUrl,
    scope: 'full',
    // Bounce is disabled by default: oracle campaign enables it.
    bounce: true,
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    replicaCount: 1,
    detail: 'source',
    pixelError: options.pixelError,
    lodAdaptive: false,
    maxResidentPages: options.maxPages,
    preload: 'visible',
    backends: [factory],
    comparisonLayout: 'single',
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
  });
  for (const light of options.lights) explorer.addLight(light);
  explorer.setEnvironment({ exposure: options.exposure });
  explorer.setPose(options.pose);
  const settle = async (frames: number) => {
    for (let i = 0; i < frames; i++) {
      await explorer.awaitPages();
      explorer.render(options.pose);
      await explorer.flush();
    }
  };
  const moveTo = (position: [number, number, number]) =>
    explorer.setLight(options.movingLight, { position });
  const shot = () => {
    const rgba = explorer.capture();
    return new Uint8Array(rgba);
  };
  // Average relative difference per channel between two images.
  const gap = (image: Uint8Array, reference: Uint8Array, mean: number) => {
    let sum = 0;
    for (let i = 0; i < image.length; i += 4)
      sum +=
        Math.abs(image[i] - reference[i]) +
        Math.abs(image[i + 1] - reference[i + 1]) +
        Math.abs(image[i + 2] - reference[i + 2]);
    return sum / (image.length / 4) / 3 / Math.max(mean, 1e-6);
  };
  const average = (image: Uint8Array) => {
    let sum = 0;
    for (let i = 0; i < image.length; i += 4) sum += image[i] + image[i + 1] + image[i + 2];
    return sum / (image.length / 4) / 3;
  };
  explorer.setLightingView('bounce');
  await settle(options.converge);
  const settled = shot();
  // Delay: light moves to second position, grid reconverges, then step is replayed tracking gaps per frame.
  const gaps: number[] = [];
  if (options.movingLight) {
    moveTo(options.movedPosition);
    await settle(options.converge);
    const moved = shot();
    const movedMean = average(moved);
    moveTo(options.originalPosition);
    await settle(options.converge);
    moveTo(options.movedPosition);
    for (let frame = 0; frame < options.delayFrames; frame++) {
      explorer.render(options.pose);
      await explorer.flush();
      gaps.push(gap(shot(), moved, movedMean));
    }
    moveTo(options.originalPosition);
    await settle(options.converge);
  }
  // Converged image sent as-is to Node, which encodes and compares with oracle.
  const body = settled.buffer.slice(settled.byteOffset, settled.byteOffset + settled.byteLength);
  await fetch(
    `/capture?file=${encodeURIComponent(options.captureFile)}&w=${canvas.width}&h=${canvas.height}`,
    { method: 'POST', body },
  );
  explorer.dispose();
  canvas.remove();
  return {
    gaps,
    rebond: bounce.length ? bounce[bounce.length - 1] : null,
  };
}
