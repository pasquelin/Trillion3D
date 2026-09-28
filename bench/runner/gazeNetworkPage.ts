// A camera session for bandwidth measurement. It never calls the image-settling barrier:
// only the ordinary, budgeted frames of the observed trajectory request texture levels.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { MeasureViewOptions } from './measureOptions.ts';
import { explorerOptions } from './explorerPage.ts';

type SdkNamespace = typeof SdkBrowser & Record<string, SdkBrowser.BackendFactory | undefined>;
let active: SdkBrowser.MeasuredWorld | null = null;
let canvas: HTMLCanvasElement | null = null;

export async function runGazeNetwork(options: MeasureViewOptions) {
  const sdk = (await import(options.sdkUrl)) as SdkNamespace;
  const factory = options.backend ? sdk[options.backend] : undefined;
  if (!factory) throw new Error(`engine missing from dist: ${options.backend}`);
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  active = await sdk.openMeasuredWorld(canvas, explorerOptions(options, factory, null));
  const poses = options.poses ?? [options.pose];
  for (let i = 0; i < options.frames; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    active.render(poses[i % poses.length]);
  }
  return { frames: options.frames, poses: poses.length };
}

export async function closeGazeNetwork() {
  await active?.dispose();
  canvas?.remove();
  active = null;
  canvas = null;
}
