// Runs in the browser through Playwright serialization: the page side of the native camera
// controller proof. Playwright sends each exported function ALONE, so everything they share —
// the explorer, the drawing, the pose reading — hangs off `globalThis.probe`, which the first
// call installs. It owns one manual explorer, swaps the controller under test, keeps the image
// of the pose a gesture starts from, and counts what differs once the gesture is undone.
import type { MeasuredWorld } from '../../../bench/witnesses/measurement.ts';

type Controls = {
  object: { position: { x: number; y: number; z: number } };
  target?: { x: number; y: number; z: number };
  minDistance?: number;
  maxDistance?: number;
  addEventListener(type: 'change', listener: () => void): void;
  update(delta?: number): boolean;
  dispose(): void;
};

declare global {
  var probe: {
    explorer: MeasuredWorld;
    controls?: Controls;
    baseline: Uint8Array;
    changes: number;
    pose(): number[];
    draw(): Promise<Uint8Array>;
  };
}

export async function openProbe() {
  const { openMeasuredWorld, webgpuPagesBackend } = window.sdk;
  const explorer = await openMeasuredWorld('viewer', {
    manifestUrl: '/cache/city/manifest.json',
    scope: 'full',
    backends: [webgpuPagesBackend],
    width: 240,
    height: 160,
    pixelRatio: 1,
    temporalAntialiasing: false,
  });
  globalThis.probe = {
    explorer,
    baseline: new Uint8Array(),
    changes: 0,
    /** Eye, orientation and pivot as they stand, so a caller can tell the pose moved. */
    pose: () => {
      const { position, quaternion } = explorer.camera;
      const target = globalThis.probe.controls?.target;
      return [
        position.x,
        position.y,
        position.z,
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
        ...(target ? [target.x, target.y, target.z] : []),
      ].map((value) => Number(value.toFixed(9)) + 0); // `+ 0` so a negative zero reads as zero.
    },
    draw: async () => {
      await explorer.awaitPages();
      explorer.render();
      await explorer.flush();
      return explorer.capture();
    },
  };
  return explorer.backend;
}

/**
 * Mounts the named controller, draws the pose it starts from, and keeps that image: every
 * gesture is judged against it, once undone.
 */
export async function beginGesture(kind: string) {
  const probe = globalThis.probe;
  const explorer = probe.explorer as unknown as Record<string, () => Controls>;
  probe.controls?.dispose();
  const controls = explorer[kind]();
  if (controls.target) {
    controls.minDistance = 0.2;
    controls.maxDistance = 40;
    controls.update();
  }
  probe.controls = controls;
  probe.changes = 0;
  controls.addEventListener('change', () => probe.changes++);
  probe.baseline = new Uint8Array(await probe.draw());
  return probe.pose();
}

/** Integrates a steered controller over a fixed step, as a host's frame loop would. */
export function stepGesture(seconds: number) {
  globalThis.probe.controls?.update(seconds);
  return globalThis.probe.pose();
}

/** Draws again and counts the bytes that differ from the image the gesture started from. */
export async function endGesture() {
  const probe = globalThis.probe;
  const image = await probe.draw();
  let differences = 0;
  for (let i = 0; i < image.length; i++) if (image[i] !== probe.baseline[i]) differences++;
  return { differences, pose: probe.pose(), changes: probe.changes, bytes: image.length };
}

/** Every module the page fetched, for the proof that no addon of the host is among them. */
export function loadedModules() {
  return performance.getEntriesByType('resource').map((entry) => entry.name);
}
