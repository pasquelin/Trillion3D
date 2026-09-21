import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { DiagnosticMode } from '../../lessons/engine-scene/diagnosticModes.ts';
import type { RendererLessonItem } from '../../lessons/rendererLessonTypes.ts';
import type {
  RendererLessonSession,
  RendererMetrics,
} from '../../lessons/rendererLessonSessionTypes.ts';
import { Canvas } from '../components/Canvas.tsx';
import { Alert, Select } from '../components/UI.tsx';
import { Stat, StatGroup } from '../components/Stats.tsx';
import { createRendererLessonRuntime } from '../../lessons/rendererLessonRuntime.ts';
import { syncRendererState } from '../../lessons/syncRendererState.ts';
import { DIAGNOSTIC_MODES, isDiagnosticMode } from '../../lessons/engine-scene/diagnosticModes.ts';
import { sceneCopy } from '../../lessons/engine-scene/content.ts';

const value = (num: number | null | undefined, suffix: string, digits = 0): string =>
  typeof num === 'number' && Number.isFinite(num) ? `${num.toFixed(digits)}${suffix}` : '—';

const poolSize = (bytes: number | null | undefined): string =>
  bytes === undefined || bytes === null
    ? '—'
    : bytes < 1048576
      ? value(bytes / 1024, ' KiB', 1)
      : value(bytes / 1048576, ' MiB', 1);

const errorMessage = (error: unknown, locale: Locale, action: 'update' | 'rendering'): string => {
  const fallback =
    action === 'update'
      ? locale === 'fr'
        ? 'Mise à jour WebGPU refusée.'
        : 'WebGPU update rejected.'
      : locale === 'fr'
        ? 'Rendu WebGPU indisponible.'
        : 'WebGPU rendering unavailable.';
  return error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback;
};

interface RendererViewportProps {
  lesson: RendererLessonItem;
  state: Record<string, number>;
  locale: Locale;
  label: string;
}

export function RendererViewport({ lesson, state, locale, label }: RendererViewportProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<RendererLessonSession | null>(null);
  const latest = useRef<Record<string, number>>(state);
  const [metrics, setMetrics] = useState<RendererMetrics>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  latest.current = state;
  useEffect(() => {
    let active = true;
    const lifecycle = new AbortController(),
      initialState = latest.current;
    setError('');
    setMetrics({});
    setPending(true);
    // The canvas ref is bound by the `Canvas` component before this effect runs.
    if (!canvas.current) return;
    createRendererLessonRuntime({
      canvas: canvas.current,
      lesson,
      state: initialState,
      report: (next: RendererMetrics) => {
        if (active) setMetrics(next);
      },
      signal: lifecycle.signal,
    })
      .then((mounted: RendererLessonSession) => {
        if (active) {
          runtime.current = mounted;
          return syncRendererState(mounted, initialState, latest.current).then(() => {
            if (active) setPending(false);
          });
        } else mounted.dispose();
      })
      .catch((err: unknown) => {
        if (active) {
          setPending(false);
          setError(errorMessage(err, locale, 'rendering'));
        }
      });
    return () => {
      active = false;
      lifecycle.abort();
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [lesson, locale]);
  useEffect(() => {
    runtime.current
      ?.update(state)
      .catch((err: unknown) => setError(errorMessage(err, locale, 'update')));
  }, [state, locale]);
  const french = locale === 'fr';
  const copy = sceneCopy[locale] ?? sceneCopy.en;
  // `RendererMetrics.diagnostic` is the engine's full mode union; the select only offers this
  // viewport's narrower `DIAGNOSTIC_MODES`, so a mode outside it (never emitted by these
  // lessons in practice) falls back to Image, the select's default.
  const diagnosticValue: DiagnosticMode =
    metrics.diagnostic && isDiagnosticMode(metrics.diagnostic) ? metrics.diagnostic : 'beauty';
  // The runtime reports the mode it draws (a lesson may set it from its own state); the select
  // shows that report, updated at once on a pick so the control never lags its own change.
  const onSelectMode = (picked: string) => {
    if (!runtime.current || !isDiagnosticMode(picked)) return;
    try {
      runtime.current.setDiagnostic(picked);
      setMetrics((current) => ({ ...current, diagnostic: picked }));
    } catch (err) {
      setError(errorMessage(err, locale, 'update'));
    }
  };
  return (
    <div
      className="geometry-3d geometry-3d-viewport flex flex-col gap-4"
      data-renderer-lesson={lesson.id}
    >
      <Canvas
        canvasRef={canvas}
        className="geometry-3d-canvas"
        label={label}
        pending={pending}
        loadingLabel={locale === 'fr' ? 'Préparation de la scène…' : 'Preparing the scene…'}
        overlay={
          <Select
            size="sm"
            className="bg-base-100/90 shadow-sm text-xs font-medium rounded-box"
            aria-label={copy.mode}
            data-renderer-diagnostic
            value={diagnosticValue}
            disabled={pending}
            onChange={(event) => onSelectMode(event.target.value)}
          >
            {DIAGNOSTIC_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {copy[mode]}
              </option>
            ))}
          </Select>
        }
        actions={[
          {
            label: french ? 'Zoom arrière' : 'Zoom out',
            symbol: '−',
            onClick: () => runtime.current?.camera.zoomOut(),
          },
          {
            label: french ? 'Zoom avant' : 'Zoom in',
            symbol: '+',
            onClick: () => runtime.current?.camera.zoomIn(),
          },
          {
            label: french ? 'Réinitialiser la caméra' : 'Reset camera',
            symbol: '↺',
            onClick: () => runtime.current?.camera.reset(),
          },
        ]}
      />
      <StatGroup>
        <Stat title="FPS">
          {metrics.idle ? (french ? 'Pause' : 'Paused') : value(metrics.fps, '')}
        </Stat>
        <Stat title={french ? 'Image CPU' : 'CPU frame'}>{value(metrics.cpu, ' ms', 2)}</Stat>
        <Stat title={french ? 'Pool alloué' : 'Allocated pool'}>{poolSize(metrics.memory)}</Stat>
        <Stat title={french ? 'Triangles dessinés' : 'Drawn triangles'}>
          {value(metrics.triangles, '')}
        </Stat>
        {lesson.shadowStats && (
          <Stat title={french ? 'Pages d’ombre redessinées' : 'Shadow pages redrawn'}>
            {value(metrics.shadowPages, '')}
          </Stat>
        )}
        {lesson.shadowStats && (
          <Stat title={french ? 'Pages d’ombre en attente' : 'Shadow pages pending'}>
            {value(metrics.shadowPending, '')}
          </Stat>
        )}
        <Stat title={french ? 'Grappes occultées' : 'Occluded clusters'}>
          {typeof metrics.occluded === 'number' && Number.isFinite(metrics.occluded)
            ? `${metrics.occluded} / ${value(metrics.tested, '')}`
            : '—'}
        </Stat>
      </StatGroup>
      {error && <Alert tone="warning">{error}</Alert>}
    </div>
  );
}
