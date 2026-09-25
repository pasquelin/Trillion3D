import { EngineError } from '../../../../sdk-core/src/index.ts';
import { probeWorldRenderer, type WorldRenderer } from '../capability/worldReady.ts';
import type { WorldNotices } from '../diagnostic/worldNotices.ts';

/**
 * The renderer a world draws with, and the one device it holds for its life: every session it
 * opens draws on it. A device lost for any reason but its own `destroy` — a driver reset, a GPU
 * process restarted — is asked for again the way the first one was (`probeWorldRenderer`), and
 * `regranted` then reopens the session on what was granted, told when the loss happened. A canvas that drew WebGPU cannot draw
 * WebGL2: a machine that grants no device any more fails that grant by name. `ready` settles with
 * the first grant, `pending` with the one asked last. `probe` stands for the machine's own.
 */
export function holdWorldDevice(
  canvas: HTMLCanvasElement,
  forced: WorldRenderer | undefined,
  regranted: (lostAt: number) => void,
  probe = probeWorldRenderer,
) {
  let renderer: WorldRenderer | null = null,
    gpuDevice: GPUDevice | undefined,
    disposed = false;
  const grant = (again: boolean): Promise<void> =>
    probe(canvas, forced).then((granted) => {
      // A world disposed while its renderer was asked for keeps nothing it was granted.
      if (disposed) return granted.gpuDevice?.destroy();
      if (again && !granted.gpuDevice)
        throw new EngineError(
          'WEBGPU_UNAVAILABLE',
          "The world's WebGPU device was lost, none granted again: its canvas cannot draw WebGL2.",
        );
      renderer = granted.renderer;
      gpuDevice = granted.gpuDevice;
      void granted.gpuDevice?.lost.then((info) => {
        if (disposed || info.reason === 'destroyed' || gpuDevice !== granted.gpuDevice) return;
        console.warn('World GPU device lost, asking for another:', info.message);
        const lostAt = performance.now();
        gpuDevice = undefined;
        pending = grant(true);
        // Granted or not, the session reopens: it waits on `pending`, and reports a refusal.
        const reopen = () => regranted(lostAt);
        pending.then(reopen, reopen);
      });
    });
  let pending = grant(false);
  // A refusal is the world's `ready` to report, never an unhandled rejection.
  pending.catch(() => {});
  return {
    ready: pending,
    /** The grant asked last: a session opens once it settles, never in a device's absence. */
    get pending() {
      return pending;
    },
    /** `'webgpu'` or `'webgl2'`, as granted and then as the open session draws; `null` before. */
    get renderer() {
      return renderer;
    },
    set renderer(drawn: WorldRenderer | null) {
      renderer = drawn;
    },
    /** The device every session opens on, `undefined` on WebGL2 or while one is asked again. */
    get gpuDevice() {
      return gpuDevice;
    },
    /** Gives the device back; a grant still pending is given back when it arrives. */
    dispose() {
      disposed = true;
      gpuDevice?.destroy();
    },
  };
}

/**
 * A world whose device was lost, then granted again (`holdWorldDevice`): its session reopens on the
 * new device, rebuilt from what the world keeps — its scene, and its decoded-page cache, so no page
 * or bundle it holds is fetched again (`pageCache.ts`) —, and the page is never reloaded. The time
 * from the loss to the first frame drawn after it is said once per recovery, under
 * `gpu-device-recovered`, with the pages the cache still held.
 */
export function worldRecovered(
  runtime: { renew(): void },
  frames: { add(hook: () => void): () => void },
  notices: WorldNotices,
  kept: { readonly pages: ReadonlyMap<string, unknown> },
  lostAt: number,
) {
  const keptPages = kept.pages.size;
  runtime.renew();
  const remove = frames.add(() => {
    remove();
    notices.say('gpu-device-recovered', 'The world drew again on a device granted after a loss', {
      recoveryMs: performance.now() - lostAt,
      keptPages,
    });
  });
}
