import assert from 'node:assert/strict';
import { after } from 'node:test';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { createWorldNotices, listenWorldNotices } from '../diagnostic/worldNotices.ts';
import type { Scene } from './scene.ts';
import { createWorldRuntime } from './worldRuntime.ts';

const saved = { location: Reflect.get(globalThis, 'location') };
Reflect.set(globalThis, 'location', new URL('http://engine.test/'));
Reflect.set(globalThis, 'ProgressEvent', globalThis.ProgressEvent ?? Event);
/** Every reopen a content change caused in these tests' runtimes: each one a defect (#837). */
const contentReopens: unknown[] = [];
const stopListening = listenWorldNotices(({ phase, context }) => {
  if (phase === 'session-reopen' && context?.defect) contentReopens.push(context);
});
/** The content reopens heard since the last call, for a test that asks one on purpose: taken,
 *  they are no longer counted a defect of these tests. */
export const takeContentReopens = () => contentReopens.splice(0);
after(() => {
  stopListening();
  assert.deepEqual(contentReopens, [], 'a content change reopened a session');
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
  canvas = { width: 1, height: 1 } as HTMLCanvasElement,
) =>
  createWorldRuntime({
    canvas,
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
    mountsPlacements: () => false,
    refreshMaterials: () => true,
    updatePlacements() {},
    setEnvironment: (environment: { irradiance?: number[] }) =>
      void (written.irradiance = environment.irradiance),
    addLight: (record: SceneLight) => void written.lights.push(record),
    setLight() {},
    removeLight: (id: string) =>
      void (written.lights = written.lights.filter((record) => record.id !== id)),
    render: () => ({}),
    /** No optional family on its way: every frame draws (`../session/familyUse.ts`). */
    familiesPending: (): Promise<void> | undefined => undefined,
    measureFrame: () => false,
    dispose() {},
  };
  return { session, written };
}
