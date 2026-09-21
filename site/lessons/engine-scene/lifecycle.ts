import { SCENE_BACKGROUND } from '../scenePalette.ts';
import { createSceneTelemetry } from './telemetry.ts';
import { configureSceneCamera } from './cameraControls.ts';
import { createLightingControls } from './lightingControls.ts';
import { addSceneFillLight } from '../sceneFillLight.ts';
import type { Explorer } from '../../../packages/sdk-browser/index.ts';
import type { FrameMetrics } from '../../../packages/sdk/index.ts';
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
  const qualityValue = required<HTMLElement>(host, '[data-scene-quality-value]');
  const shadows = required<HTMLInputElement>(host, '[data-scene-shadows]');
  const status = required<HTMLElement>(host, '[data-scene-status]');
  const loading = required<HTMLElement>(host, '[data-scene-loading]');
  const controller = new AbortController();
  let explorer: Explorer | null | undefined,
    disposed = false,
    camera: ReturnType<typeof configureSceneCamera> | undefined,
    lighting: ReturnType<typeof createLightingControls> | undefined;
  const events = { signal: controller.signal };
  const telemetry = createSceneTelemetry(host, copy, locale);
  const invalidate = () => {
    if (!disposed) explorer?.invalidate();
  };
  const selectedMode = () => (isDiagnosticMode(mode.value) ? mode.value : 'beauty');
  const updateGuide = () => {
    const [what, tryThis, observe] = copy.views[selectedMode()];
    required<HTMLElement>(host, '[data-scene-what]').textContent = what;
    required<HTMLElement>(host, '[data-scene-try]').textContent = tryThis;
    required<HTMLElement>(host, '[data-scene-observe]').textContent = observe;
  };
  const load = async () => {
    start.disabled = true;
    start.hidden = true;
    loading.hidden = false;
    status.textContent = '';
    try {
      if (!navigator.gpu) throw new Error('WEBGPU_UNAVAILABLE');
      const { createExplorer } = await import('../../../packages/sdk-browser/index.ts');
      if (disposed) return;
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
          // the frame diagnostic's context always carries FrameMetrics under this key
          if (!disposed && event.phase === 'frame')
            telemetry.frame(event.context.metrics as FrameMetrics);
        },
        onEvent: (event) => {
          if (!disposed && event.type === 'fatal') status.textContent = copy.failed;
        },
      });
      if (disposed) {
        created.dispose();
        return;
      }
      explorer = created;
      addSceneFillLight(explorer);
      for (const option of mode.options)
        option.disabled =
          isDiagnosticMode(option.value) && explorer.diagnostics[option.value]?.available === false;
      if (mode.value !== 'beauty') explorer.setDiagnostic(selectedMode());
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
      if (disposed) return;
      telemetry.stop();
      explorer?.dispose();
      explorer = null;
      const message = /WEBGPU|adapter|GPU/.test(String(error))
        ? copy.unavailable
        : `${copy.failed} (${errorMessage(error)})`;
      status.textContent = message;
      loading.hidden = true;
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
        explorer?.setDiagnostic(selectedMode());
        invalidate();
      } catch (error) {
        status.textContent = `${copy.failed} (${errorMessage(error)})`;
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
