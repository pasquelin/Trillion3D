import { probeWorldRenderer, type WorldRenderer } from '../capability/worldReady.ts';

/**
 * The renderer a world draws with, and the one device it holds for its life: every session it
 * opens draws on it. A device lost for any reason but its own `destroy` — a driver reset, a GPU
 * process restarted — is asked for again the way the first one was (`probeWorldRenderer`), and
 * `regranted` then reopens the session on what was granted; a machine that grants nothing any
 * more is reported. `ready` settles with the first grant. `probe` stands for the machine's own.
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
  const grant = (): Promise<void> =>
    probe(canvas, forced).then((granted) => {
      // A world disposed while its renderer was asked for keeps nothing it was granted.
      if (disposed) return granted.gpuDevice?.destroy();
      renderer = granted.renderer;
      gpuDevice = granted.gpuDevice;
      void granted.gpuDevice?.lost.then((info) => {
        if (disposed || info.reason === 'destroyed' || gpuDevice !== granted.gpuDevice) return;
        console.warn('World GPU device lost, asking for another:', info.message);
        gpuDevice = undefined;
        grant().then(regranted, (error) =>
          console.error('World GPU device not granted again', error),
        );
      });
    });
  return {
    ready: grant(),
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
