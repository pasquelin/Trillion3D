import { SCENE_BACKGROUND } from '../scenePalette.ts';
import { createSceneTelemetry } from './telemetry.ts';
import { configureSceneCamera } from './cameraControls.ts';
import { createLightingControls } from './lightingControls.ts';
import { addSceneFillLight } from '../sceneFillLight.ts';
import {
  createWorld,
  math,
  pose,
  light as lightFamily,
  type World,
} from '../../../packages/sdk-browser/index.ts';
import { isDiagnosticMode } from './diagnosticModes.ts';
import type { SceneCopy } from './content.ts';
import type { Locale } from '../../content/locale.ts';

// The mount template (docs/index.html) always renders these nodes alongside the scene host.
const required = <T extends Element>(host: ParentNode, selector: string): T =>
  host.querySelector<T>(selector)!; // the mount template always renders this node

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function mountScene(host: ParentNode, copy: SceneCopy, locale: Locale) {
  const canvas = required<HTMLCanvasElement>(host, '[data-scene-canvas]');
  const start = required<HTMLButtonElement>(host, '[data-scene-start]');
  const mode = required<HTMLSelectElement>(host, '[data-scene-mode]');
  const home = required<HTMLButtonElement>(host, '[data-scene-home]');
  const zoomIn = required<HTMLButtonElement>(host, '[data-scene-zoom-in]');
  const zoomOut = required<HTMLButtonElement>(host, '[data-scene-zoom-out]');
  const light = required<HTMLInputElement>(host, '[data-scene-light]');
  const lightValue = required<HTMLElement>(host, '[data-scene-light-value]');
  const quality = required<HTMLInputElement>(host, '[data-scene-quality]');
  const shadows = required<HTMLInputElement>(host, '[data-scene-shadows]');
  const status = required<HTMLElement>(host, '[data-scene-status]');
  const loading = required<HTMLElement>(host, '[data-scene-loading]');
  const controller = new AbortController();
  // Each load runs under its own generation: a failure or a loss ends the current one, so a
  // create still pending when it happens is released once it settles, never adopted.
  let world: World | null | undefined,
    disposed = false,
    generation = 0,
    camera: ReturnType<typeof configureSceneCamera> | undefined,
    lighting: ReturnType<typeof createLightingControls> | undefined;
  const events = { signal: controller.signal };
  const telemetry = createSceneTelemetry(host, copy, locale);
  const invalidate = () => {
    if (!disposed) world?.invalidate();
  };
  /** The scene is gone: what it held is released, and the start button offers to reopen it. */
  const fail = (message: string) => {
    generation++;
    telemetry.stop();
    world?.dispose();
    world = null;
    camera = lighting = undefined;
    status.textContent = message;
    loading.hidden = true;
    start.disabled = false;
    start.hidden = false;
    start.textContent = copy.retry;
  };
  const selectedMode = () => (isDiagnosticMode(mode.value) ? mode.value : 'beauty');
  const updateGuide = () => {
    const [what, tryThis, observe] = copy.views[selectedMode()];
    required<HTMLElement>(host, '[data-scene-what]').textContent = what;
    required<HTMLElement>(host, '[data-scene-try]').textContent = tryThis;
    required<HTMLElement>(host, '[data-scene-observe]').textContent = observe;
  };
  const load = async () => {
    const attempt = generation;
    const superseded = () => disposed || attempt !== generation;
    start.disabled = true;
    start.hidden = true;
    loading.hidden = false;
    status.textContent = '';
    try {
      if (disposed) return;
      const created = createWorld(canvas, {
        pixelRatio: window.devicePixelRatio,
        signal: controller.signal,
        controls: 'orbit',
      });
      created.scene.background = math.color(SCENE_BACKGROUND.packed);
      const model = await created.scene.load(
        new URL('assets/kinetic-garden/cache/native/full/manifest.json', document.baseURI).href,
      );
      if (superseded()) {
        created.dispose();
        return;
      }
      world = created;
      // The exact budgets shown in the displayed code (`code.ts`): keep the two in sync.
      world.budget.geometryPool = 16 * 1024 * 1024;
      world.budget.texturePool = 128 * 1024 * 1024;
      addSceneFillLight(lightFamily, world);
      for (const option of mode.options)
        option.disabled =
          isDiagnosticMode(option.value) && !world.diagnostic.modes.includes(option.value);
      if (mode.value !== 'beauty') world.diagnostic.mode = selectedMode();
      lighting = createLightingControls(model.lights, light, lightValue, shadows, copy, invalidate);
      const bounds = model.bounds;
      camera = configureSceneCamera(pose, world, bounds);
      camera.reset();
      world.onFrame(({ metrics }) => {
        if (!superseded()) telemetry.frame(world!, metrics);
      });
      loading.hidden = true;
      start.hidden = true;
      mode.disabled = false;
      home.disabled = false;
      zoomIn.disabled = false;
      zoomOut.disabled = false;
      light.disabled = !lighting.hasLights;
      quality.disabled = true; // `world.pixelError` is a public property; this lesson does not wire a control to it
      shadows.disabled = !lighting.hasShadows;
      status.textContent = '';
      invalidate();
    } catch (error) {
      if (superseded()) return;
      fail(
        /WEBGPU|adapter|GPU/.test(String(error))
          ? copy.unavailable
          : `${copy.failed} (${errorMessage(error)})`,
      );
    }
  };
  start.addEventListener('click', load, events);
  mode.addEventListener(
    'change',
    () => {
      updateGuide();
      try {
        if (world) world.diagnostic.mode = selectedMode();
        invalidate();
      } catch (error) {
        status.textContent = `${copy.failed} (${errorMessage(error)})`;
      }
    },
    events,
  );
  light.addEventListener('input', () => lighting?.apply(), events);
  shadows.addEventListener('change', () => lighting?.apply(), events);
  home.addEventListener(
    'click',
    () => {
      camera?.reset();
      invalidate();
    },
    events,
  );
  zoomIn.addEventListener(
    'click',
    () => {
      camera?.zoomIn();
      invalidate();
    },
    events,
  );
  zoomOut.addEventListener(
    'click',
    () => {
      camera?.zoomOut();
      invalidate();
    },
    events,
  );
  document.addEventListener('visibilitychange', invalidate, events);
  load();
  return () => {
    disposed = true;
    controller.abort();
    telemetry.stop();
    world?.dispose();
  };
}
