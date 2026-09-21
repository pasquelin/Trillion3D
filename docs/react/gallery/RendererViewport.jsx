import { useEffect, useRef, useState } from 'react';
import { Canvas } from '../components/Canvas.jsx';
import { Alert, Select } from '../components/UI.jsx';
import { Stat, StatGroup } from '../components/Stats.jsx';
import { createRendererLessonRuntime } from '../../js/gallery/rendererLessonRuntime.js';
import { syncRendererState } from '../../js/gallery/syncRendererState.js';
import { DIAGNOSTIC_MODES } from '../../js/engine-scene/diagnosticModes.js';
import { sceneCopy } from '../../js/engine-scene/content.js';

const value = (number, suffix, digits = 0) =>
  Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : '—';
const errorMessage = (error, locale, action) => {
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

export function RendererViewport({ lesson, state, locale, label }) {
  const canvas = useRef(null),
    runtime = useRef(null),
    latest = useRef(state),
    [metrics, setMetrics] = useState({}),
    [error, setError] = useState(''),
    [pending, setPending] = useState(true);
  latest.current = state;
  useEffect(() => {
    let active = true;
    const lifecycle = new AbortController(),
      initialState = latest.current;
    setError('');
    setMetrics({});
    setPending(true);
    createRendererLessonRuntime({
      canvas: canvas.current,
      lesson,
      state: initialState,
      report: (next) => active && setMetrics(next),
      signal: lifecycle.signal,
    })
      .then((mounted) => {
        if (active) {
          runtime.current = mounted;
          return syncRendererState(mounted, initialState, latest.current).then(() => {
            if (active) setPending(false);
          });
        } else mounted.dispose();
      })
      .catch((error) => {
        if (active) {
          setPending(false);
          setError(errorMessage(error, locale, 'rendering'));
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
      .catch((error) => setError(errorMessage(error, locale, 'update')));
  }, [state, locale]);
  const french = locale === 'fr',
    copy = sceneCopy[locale] ?? sceneCopy.en;
  // The runtime reports the mode it draws (a lesson may set it from its own state); the select
  // shows that report, updated at once on a pick so the control never lags its own change.
  const onSelectMode = (mode) => {
    if (!runtime.current) return;
    try {
      runtime.current.setDiagnostic(mode);
      setMetrics((current) => ({ ...current, diagnostic: mode }));
    } catch (err) {
      setError(errorMessage(err, locale, 'update'));
    }
  };
  return (
    <div className="geometry-3d grid gap-4" data-renderer-lesson={lesson.id}>
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
            value={metrics.diagnostic ?? 'beauty'}
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
        <Stat title={french ? 'Pool alloué' : 'Allocated pool'}>
          {metrics.memory < 1048576
            ? value(metrics.memory / 1024, ' KiB', 1)
            : value(metrics.memory / 1048576, ' MiB', 1)}
        </Stat>
        <Stat title={french ? 'Triangles dessinés' : 'Drawn triangles'}>
          {value(metrics.triangles, '')}
        </Stat>
        <Stat title={french ? 'Grappes occultées' : 'Occluded clusters'}>
          {Number.isFinite(metrics.occluded)
            ? `${metrics.occluded} / ${value(metrics.tested, '')}`
            : '—'}
        </Stat>
      </StatGroup>
      {error && <Alert tone="warning">{error}</Alert>}
    </div>
  );
}
