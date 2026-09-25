import { readFile } from 'node:fs/promises';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import type { Scene } from './scene.ts';
import { createWorldRuntime } from './worldRuntime.ts';

/** The site's own caches, served from disk; the GPU is the one thing these tests have not. */
export const HOST = 'http://site.test/';
const SITE = new URL('../../../../../site/', import.meta.url);
const saved = { fetch: globalThis.fetch, location: Reflect.get(globalThis, 'location') };
/** A slow disk on demand: every read waits this long first (`WORLD_FIXTURE_READ_DELAY_MS`). */
const READ_DELAY_MS = Number(process.env.WORLD_FIXTURE_READ_DELAY_MS ?? 0);
let reading = 0;
/** Disk reads still in flight: a loop gone idle leaves none behind. */
export const readsInFlight = () => reading;
const serve = async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const path = fileURLToPath(new URL(url.slice(HOST.length), SITE));
  const json = /\.(json|gltf)$/.test(path);
  const type = json ? 'application/json' : 'application/octet-stream';
  reading++;
  try {
    if (READ_DELAY_MS > 0) await new Promise((done) => setTimeout(done, READ_DELAY_MS));
    return new Response(await readFile(path), { headers: { 'content-type': type } });
  } finally {
    reading--;
  }
};
globalThis.fetch = serve as typeof fetch;
Reflect.set(globalThis, 'location', new URL(HOST));
Reflect.set(globalThis, 'ProgressEvent', globalThis.ProgressEvent ?? Event);
after(() => {
  globalThis.fetch = saved.fetch;
  Reflect.set(globalThis, 'location', saved.location);
});

export type Open = NonNullable<Parameters<typeof createWorldRuntime>[0]['open']>;

/** A runtime on a canvas stand-in, whose every failure is handed to `failed`. */
export const runtimeOf = (
  scene: Scene,
  ready: Promise<void>,
  failed: (error: unknown) => void,
  open?: Open,
  opening: () => void = () => {},
) =>
  createWorldRuntime({
    canvas: { width: 1, height: 1 } as HTMLCanvasElement,
    scene,
    ready: () => ready,
    open,
    camera: () => new Camera('perspective'),
    options: () => ({ manifestUrl: '' }),
    opened: () => {},
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    diagnostic: { notices: createWorldNotices(), failed, opening },
  });

export const until = async (done: () => boolean) => {
  for (let waited = 0; !done() && waited < 5000; waited += 20)
    await new Promise((resolve) => setTimeout(resolve, 20));
};

/** A session stand-in: what the runtime writes into it — lights, view, environment — is kept. */
export function sessionStandIn() {
  const written = {
    view: 'auto',
    lights: [] as SceneLight[],
    irradiance: undefined as number[] | undefined,
  };
  const session = {
    camera: {
      position: { set() {} },
      quaternion: { set() {} },
      updateProjectionMatrix() {},
      updateMatrixWorld() {},
    },
    setLightingView: (view: string) => void (written.view = view),
    invalidate() {},
    growsPlacements: () => false,
    refreshMaterials: () => true,
    updatePlacements() {},
    setEnvironment: (environment: { irradiance?: number[] }) =>
      void (written.irradiance = environment.irradiance),
    addLight: (record: SceneLight) => void written.lights.push(record),
    setLight() {},
    removeLight: (id: string) =>
      void (written.lights = written.lights.filter((record) => record.id !== id)),
    render: () => ({}),
    dispose() {},
  };
  return { session, written };
}
