import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  GeometryPreviewProps,
  IllustrationSession,
  WebGPUCanvasProps,
} from '../types/gallery.ts';
import { Canvas } from '../components/Canvas.tsx';
import { Alert } from '../components/UI.tsx';
import { Stat, StatGroup } from '../components/Stats.tsx';
import { mountIllustration } from '../../js/gallery/webgpuRenderer.js';
import { initialState } from '../../js/gallery/scenarios.js';

export function GeometryPreview({
  id,
  locale = 'en',
  interactive = true,
  label,
  related = false,
}: GeometryPreviewProps): ReactElement {
  const state = useMemo(() => initialState(id) as Record<string, number>, [id]);
  return (
    <WebGPUCanvas
      id={id}
      state={state}
      locale={locale}
      interactive={interactive}
      preview={!interactive}
      label={label ?? `${id} — 3D`}
      related={related}
    />
  );
}

export function WebGPUCanvas({
  id,
  state,
  locale,
  preview = false,
  interactive = !preview,
  animating = false,
  label,
  related = false,
}: WebGPUCanvasProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mounted = useRef<IllustrationSession | null>(null);
  const latestState = useRef<Record<string, number>>(state);
  const latestAnimating = useRef<boolean>(animating);
  const [error, setError] = useState<string>('');
  latestState.current = state;
  latestAnimating.current = animating;
  useEffect(() => {
    let active = true;
    let observer: IntersectionObserver | undefined;
    const mount = () =>
      mountIllustration(canvas.current, id, latestState.current, { locale, interactive })
        .then((value: IllustrationSession) => {
          if (active) {
            mounted.current = value;
            value.setAnimating?.(latestAnimating.current);
            value.update(latestState.current);
          } else value.dispose();
        })
        .catch(
          () =>
            active &&
            setError(locale === 'fr' ? 'Rendu 3D indisponible.' : '3D rendering unavailable.'),
        );
    if (preview && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer?.disconnect();
            mount();
          }
        },
        { rootMargin: '200px' },
      );
      if (canvas.current) observer.observe(canvas.current);
    } else mount();
    return () => {
      active = false;
      observer?.disconnect();
      mounted.current?.dispose();
      mounted.current = null;
    };
  }, [id, interactive, locale, preview]);
  useEffect(() => {
    mounted.current?.update(state);
  }, [state]);
  useEffect(() => {
    mounted.current?.setAnimating?.(animating);
  }, [animating]);
  const french = locale === 'fr';
  return (
    <div
      className={`geometry-3d${preview ? ' geometry-3d-preview gallery-preview' : ' grid gap-4'}${related ? ' geometry-3d-related' : ''}`}
      data-geometry-3d={id}
    >
      <Canvas
        canvasRef={canvas}
        className="geometry-3d-canvas rounded-box"
        label={label}
      />
      {!preview && (
        <StatGroup data-geometry-stats>
          <Stat title="FPS" valueProps={{ 'data-geometry-fps': true }}>
            {french ? 'Pause' : 'Paused'}
          </Stat>
          <Stat
            title={french ? 'Encodage CPU' : 'CPU encode'}
            valueProps={{ 'data-geometry-cpu': true }}
          >
            —
          </Stat>
          <Stat
            title={french ? 'Buffers visuels' : 'Visual buffers'}
            valueProps={{ 'data-geometry-memory': true }}
          >
            —
          </Stat>
        </StatGroup>
      )}
      <Alert className={error ? '' : 'hidden'} data-geometry-3d-status>
        {error}
      </Alert>
    </div>
  );
}
