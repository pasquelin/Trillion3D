import { EngineError } from '../../../../sdk-core/src/index.ts';
import { probeWorldRenderer, type WorldRenderer } from '../capability/worldReady.ts';

/**
 * The renderer a world draws with, and the one device it holds for its life: every session it
 * opens draws on it. A device lost for any reason but its own `destroy` — a driver reset, a GPU
 * process restarted — is asked for again the way the first one was (`probeWorldRenderer`), and
 * `regranted` then reopens the session on what was granted. A canvas that drew WebGPU cannot draw
 * WebGL2: a machine that grants no device any more fails that grant by name. `ready` settles with
 * the first grant, `pending` with the one asked last. `probe` stands for the machine's own.
 */
export function holdWorldDevice(
  canvas: HTMLCanvasElement,
  forced: WorldRenderer | undefined,
  regranted: () => void,
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
        gpuDevice = undefined;
        pending = grant(true);
        // Granted or not, the session reopens: it waits on `pending`, and reports a refusal.
        pending.then(regranted, regranted);
      });
    });
  let pending = grant(false);
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
