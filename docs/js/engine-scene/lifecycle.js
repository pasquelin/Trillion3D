import { SCENE_BACKGROUND } from '../scenePalette.js';
import { createSceneTelemetry } from './telemetry.js';
import { configureSceneCamera } from './cameraControls.js';
import { createLightingControls } from './lightingControls.js';
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
  const placeholder = host.querySelector('[data-scene-placeholder]');
  const placeholderStatus = host.querySelector('[data-scene-placeholder-status]');
  const controller = new AbortController();
  let explorer,
    controls,
    observer,
    frame = 0,
    disposed = false,
    settling = 0,
    camera,
    lighting;
  const events = { signal: controller.signal };
  const telemetry = createSceneTelemetry(host, copy, locale);
  const tick = (now) => {
    frame = 0;
    if (disposed || !explorer || document.hidden) return;
    try {
      const metrics = explorer.render();
      telemetry.frame(metrics, now);
      if (--settling > 0) frame = requestAnimationFrame(tick);
      else telemetry.idle();
    } catch (error) {
      status.textContent = `${copy.failed} (${error.message})`;
    }
  };
  const invalidate = () => {
    settling = 32;
    if (!frame && !disposed) {
      telemetry.reset();
      frame = requestAnimationFrame(tick);
    }
  };
  const updateGuide = () => {
    const [what, tryThis, observe] = copy.views[mode.value];
    host.querySelector('[data-scene-what]').textContent = what;
    host.querySelector('[data-scene-try]').textContent = tryThis;
    host.querySelector('[data-scene-observe]').textContent = observe;
  };
  const load = async () => {
    start.disabled = true;
    start.hidden = true;
    placeholder.hidden = false;
    placeholder.querySelector('.loading').hidden = false;
    placeholderStatus.textContent = copy.loading;
    status.textContent = copy.loading;
    try {
      if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE');
      const { createExplorer, webgpuPagesBackend } = await import('../../runtime/engine.js');
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const created = await createExplorer(canvas, {
        manifestUrl: new URL(
          'assets/kinetic-garden/cache/native/full/manifest.json',
          document.baseURI,
        ).href,
        scope: 'full',
        backends: [webgpuPagesBackend],
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        pixelRatio: window.devicePixelRatio,
        pixelError: 0,
        lodAdaptive: false,
        temporalAntialiasing: true,
        geometryPoolBytes: 16 * 1024 * 1024,
        texturePoolBytes: 128 * 1024 * 1024,
        maxCachedBytes: 16 * 1024 * 1024,
        pageFetchWorkers: 2,
        clearColor: SCENE_BACKGROUND.packed,
        signal: controller.signal,
        diagnosticDetail: 'summary',
      });
      if (disposed) {
        created.dispose();
        return;
      }
      explorer = created;
      for (const option of mode.options)
        option.disabled = explorer.diagnostics[option.value]?.available === false;
      if (mode.value !== 'beauty') explorer.setDiagnostic(mode.value);
      lighting = createLightingControls(explorer, light, lightValue, shadows, copy, invalidate);
      controls = explorer.controls();
      camera = configureSceneCamera(explorer, controls);
      controls.addEventListener('change', invalidate);
      await explorer.awaitPages();
      if (disposed) return;
      camera.reset();
      observer = new ResizeObserver(() => {
        const bounds = canvas.getBoundingClientRect();
        explorer.resize(
          Math.max(1, Math.round(bounds.width)),
          Math.max(1, Math.round(bounds.height)),
        );
        invalidate();
      });
      observer.observe(canvas);
      placeholder.hidden = true;
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
      if (disposed) return;
      observer?.disconnect();
      controls?.dispose();
      explorer?.dispose();
      explorer = null;
      const message = /WEBGPU|adapter|GPU/.test(String(error))
        ? copy.unavailable
        : `${copy.failed} (${error.message})`;
      status.textContent = message;
      placeholderStatus.textContent = copy.failed;
      placeholder.querySelector('.loading').hidden = true;
      start.disabled = false;
      start.hidden = false;
      start.textContent = copy.retry;
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
    cancelAnimationFrame(frame);
    observer?.disconnect();
    controls?.dispose();
    explorer?.dispose();
  };
}
