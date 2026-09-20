import { useEffect, useRef, useState } from 'react';
import { Canvas } from '../components/Canvas.jsx';
import { Alert } from '../components/UI.jsx';
import { Stat, StatGroup } from '../components/Stats.jsx';
import { createRendererLessonRuntime } from '../../js/gallery/rendererLessonRuntime.js';

const value = (number, suffix, digits = 0) =>
  Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : '—';

export function RendererViewport({ lesson, state, locale, label }) {
  const canvas = useRef(null),
    runtime = useRef(null),
    latest = useRef(state),
    [metrics, setMetrics] = useState({}),
    [error, setError] = useState('');
  latest.current = state;
  useEffect(() => {
    let active = true;
    createRendererLessonRuntime({
      canvas: canvas.current,
      lesson,
      state: latest.current,
      report: setMetrics,
    })
      .then((mounted) => {
        if (active) {
          runtime.current = mounted;
          mounted.update(latest.current);
        } else mounted.dispose();
      })
      .catch(
        () =>
          active &&
          setError(
            locale === 'fr' ? 'Rendu WebGPU indisponible.' : 'WebGPU rendering unavailable.',
          ),
      );
    return () => {
      active = false;
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [lesson, locale]);
  useEffect(() => {
    runtime.current
      ?.update(state)
      .catch(() => setError(locale === 'fr' ? 'Mise à jour refusée.' : 'Update rejected.'));
  }, [state, locale]);
  const french = locale === 'fr';
  return (
    <div className="geometry-3d grid gap-4" data-renderer-lesson={lesson.id}>
      <Canvas canvasRef={canvas} className="geometry-3d-canvas" label={label} />
      <StatGroup>
        <Stat title="FPS">
          {metrics.idle ? (french ? 'Pause' : 'Paused') : value(metrics.fps, '')}
        </Stat>
        <Stat title={french ? 'Image CPU' : 'CPU frame'}>{value(metrics.cpu, ' ms', 2)}</Stat>
        <Stat title={french ? 'Pool alloué' : 'Allocated pool'}>
          {value(metrics.memory / 1048576, ' MiB', 1)}
        </Stat>
        <Stat title={french ? 'Triangles dessinés' : 'Drawn triangles'}>
          {value(metrics.triangles, '')}
        </Stat>
      </StatGroup>
      {error && <Alert tone="warning">{error}</Alert>}
    </div>
  );
}
