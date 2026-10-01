import { holdWorldDevice } from '../core/worldDevice.ts';
import type { WorldOptions } from '../core/worldOptions.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { createXrReleases } from './releases.ts';
import { createWorldXr } from './session.ts';
import { xrRendererCompatible } from './options.ts';
export { xrWorldOptions } from './options.ts';

export function worldXr(
  runtime: {
    readonly explorer: MeasuredWorld | null;
    settled(): Promise<void>;
    render(ahead?: () => void): unknown;
    invalidate(): void;
  },
  device: { ready: Promise<unknown>; renderer: string | null; xrCompatible?: boolean },
  ahead: () => void,
  failed: (error: unknown) => void,
) {
  let owner: MeasuredWorld | null = null;
  const releases = createXrReleases(failed);
  const xr = createWorldXr(
    {
      beforeEnter() {
        if (!device.renderer)
          throw new Error('XR_WORLD_NOT_READY: await world.ready before enabling XR entry');
        if (device.renderer === 'webgpu' && !device.xrCompatible)
          throw new Error('XR_WEBGPU_INCOMPATIBLE: create the world with xr: true');
      },
      requiredFeatures: () => (device.renderer === 'webgpu' ? ['webgpu'] : []),
      compatible: async () => {
        await device.ready;
        return xrRendererCompatible(device.renderer, device.xrCompatible);
      },
      async open(session, mode) {
        if (device.renderer === 'webgpu' && !device.xrCompatible)
          throw new Error('XR_WEBGPU_INCOMPATIBLE: create the world with xr: true');
        await runtime.settled();
        owner = runtime.explorer;
        if (!owner) throw new Error('XR_WORLD_EMPTY: load or add the scene before entering');
        owner.setXrActive(true);
        return owner.openXr(
          session,
          () => {
            if (runtime.explorer !== owner) throw new Error('XR_WORLD_REOPENED');
            runtime.render(ahead);
          },
          mode === 'immersive-ar',
        );
      },
      active(on) {
        runtime.explorer?.setXrActive(on);
        if (!on) {
          owner?.setXrActive(false);
          owner = null;
          runtime.invalidate();
        }
      },
      failed,
    },
    releases,
  );
  return {
    xr,
    release(done: () => void) {
      const previous = owner ?? runtime.explorer;
      const released = xr.dispose();
      if (released) previous?.setXrActive(true);
      if (released)
        void released.then(done, (error) => {
          done();
          failed(error);
        });
      else done();
    },
    closing() {
      if (!owner) return releases.wait();
      return xr
        .exit()
        .then(() =>
          failed(
            new Error('XR_WORLD_REOPENED: immersive session ended before replacing its renderer'),
          ),
        );
    },
  };
}

/** XR compatibility is fixed before the browser grants a canvas context. */
export function holdXrWorldDevice(
  canvas: HTMLCanvasElement,
  options: WorldOptions,
  recovered: (lostAt: number) => void,
) {
  return holdWorldDevice(canvas, options.renderer, recovered, undefined, options.xr);
}
