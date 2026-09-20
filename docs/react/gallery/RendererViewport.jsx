import { useEffect, useRef, useState } from 'react';
import { Canvas } from '../components/Canvas.jsx';
import { Alert } from '../components/UI.jsx';
import { Stat, StatGroup } from '../components/Stats.jsx';
import { createRendererLessonRuntime } from '../../js/gallery/rendererLessonRuntime.js';

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
    [error, setError] = useState('');
  latest.current = state;
  useEffect(() => {
    let active = true;
    const lifecycle = new AbortController();
    setError('');
    setMetrics({});
    createRendererLessonRuntime({
      canvas: canvas.current,
      lesson,
      state: latest.current,
      report: (next) => active && setMetrics(next),
      signal: lifecycle.signal,
    })
      .then((mounted) => {
        if (active) {
          runtime.current = mounted;
        } else mounted.dispose();
      })
      .catch((error) => active && setError(errorMessage(error, locale, 'rendering')));
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
  const french = locale === 'fr';
  return (
    <div className="geometry-3d grid gap-4" data-renderer-lesson={lesson.id}>
      <Canvas
        canvasRef={canvas}
        className="geometry-3d-canvas"
        label={label}
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
      </StatGroup>
      {error && <Alert tone="warning">{error}</Alert>}
    </div>
  );
}
