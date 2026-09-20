import { SCENE_BACKGROUND } from '../scenePalette.js';
import { createSceneTelemetry } from './telemetry.js';
import { configureSceneCamera } from './cameraControls.js';
import { createLightingControls } from './lightingControls.js';
import { addSceneFillLight } from '../sceneFillLight.js';
export function mountScene(host, copy, locale) {
  const canvas = host.querySelector('[data-scene-canvas]');
  const start = host.querySelector('[data-scene-start]');
  const mode = host.querySelector('[data-scene-mode]');
  const home = host.querySelector('[data-scene-home]');
  const zoomIn = host.querySelector('[data-scene-zoom-in]');
  const zoomOut = host.querySelector('[data-scene-zoom-out]');
  const light = host.querySelector('[data-scene-light]');
  const lightValue = host.querySelector('[data-scene-light-value]');
  const quality = host.querySelector('[data-scene-quality]');
  const qualityValue = host.querySelector('[data-scene-quality-value]');
  const shadows = host.querySelector('[data-scene-shadows]');
  const status = host.querySelector('[data-scene-status]');
  const loading = host.querySelector('[data-scene-loading]');
  const controller = new AbortController();
  let explorer,
    disposed = false,
    lost = false,
    camera,
    lighting;
  const events = { signal: controller.signal };
  const telemetry = createSceneTelemetry(host, copy, locale);
  const invalidate = () => {
    if (!disposed) explorer?.invalidate();
  };
  /** The scene is gone: what it held is released, and the start button offers to reopen it. */
  const fail = (message) => {
    telemetry.stop();
    explorer?.dispose();
    explorer = null;
    status.textContent = message;
    loading.hidden = true;
    start.disabled = false;
    start.hidden = false;
    start.textContent = copy.retry;
  };
  const updateGuide = () => {
    const [what, tryThis, observe] = copy.views[mode.value];
    host.querySelector('[data-scene-what]').textContent = what;
    host.querySelector('[data-scene-try]').textContent = tryThis;
    host.querySelector('[data-scene-observe]').textContent = observe;
  };
  const load = async () => {
    lost = false;
    start.disabled = true;
    start.hidden = true;
    loading.hidden = false;
    status.textContent = '';
    try {
      if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE');
      const { createExplorer } = await import('../../runtime/engine.js');
      if (disposed) return;
      // The engine has already withdrawn its image on a loss: only a new explorer draws again,
      // and one still preparing when it happens is released as soon as it exists.
      const created = await createExplorer(canvas, {
        manifestUrl: new URL(
          'assets/kinetic-garden/cache/native/full/manifest.json',
          document.baseURI,
        ).href,
        scope: 'full',
        interactive: true,
        pixelError: 0,
        lodAdaptive: false,
        temporalAntialiasing: true,
        geometryPoolBytes: 16 * 1024 * 1024,
        texturePoolBytes: 128 * 1024 * 1024,
        maxCachedBytes: 16 * 1024 * 1024,
        pageFetchWorkers: 2,
        clearColor: SCENE_BACKGROUND.packed,
        signal: controller.signal,
        diagnosticDetail: 'trace',
        onDiagnostic: (event) => {
          if (disposed) return;
          if (event.phase === 'frame') telemetry.frame(event.context.metrics);
          else if (event.phase === 'gpu-device-lost') {
            lost = true;
            fail(copy.lost);
          }
        },
        onEvent: (event) => {
          if (!disposed && event.type === 'fatal') status.textContent = copy.failed;
        },
      });
      if (disposed || lost) {
        created.dispose();
        return;
      }
      explorer = created;
      addSceneFillLight(explorer);
      for (const option of mode.options)
        option.disabled = explorer.diagnostics[option.value]?.available === false;
      if (mode.value !== 'beauty') explorer.setDiagnostic(mode.value);
      lighting = createLightingControls(explorer, light, lightValue, shadows, copy, invalidate);
      const controls = explorer.controls();
      camera = configureSceneCamera(explorer, controls);
      camera.reset();
      loading.hidden = true;
      start.hidden = true;
      mode.disabled = false;
      home.disabled = false;
      zoomIn.disabled = false;
      zoomOut.disabled = false;
      light.disabled = !lighting.hasLights;
      quality.disabled = false;
      shadows.disabled = !lighting.hasShadows;
      status.textContent = '';
      invalidate();
    } catch (error) {
      if (disposed || lost) return;
      fail(
        /WEBGPU|adapter|GPU/.test(String(error))
          ? copy.unavailable
          : `${copy.failed} (${error.message})`,
      );
    }
  };
  start.addEventListener('click', load, events);
  mode.addEventListener(
    'change',
    () => {
      updateGuide();
      try {
        explorer?.setDiagnostic(mode.value);
        invalidate();
      } catch (error) {
        status.textContent = `${copy.failed} (${error.message})`;
      }
    },
    events,
  );
  light.addEventListener('input', () => lighting?.apply(), events);
  quality.addEventListener(
    'input',
    () => {
      qualityValue.textContent = `${quality.value} px`;
      explorer?.setPixelError(Number(quality.value));
      invalidate();
    },
    events,
  );
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
    explorer?.dispose();
  };
}
