import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { IllustrationSession } from '../../lessons/webgpuSession.ts';
import { Canvas } from '../components/Canvas.tsx';
import { Alert } from '../components/UI.tsx';
import { Stat, StatGroup } from '../components/Stats.tsx';
import { mountIllustration } from '../../lessons/webgpuRenderer.ts';
import { initialState } from '../../lessons/scenarios.ts';

export interface WebGPUCanvasProps {
  id: string;
  state: Record<string, number>;
  locale: Locale;
  preview?: boolean;
  interactive?: boolean;
  animating?: boolean;
  label?: string;
  related?: boolean;
}

type GeometryPreviewProps = Pick<
  WebGPUCanvasProps,
  'id' | 'locale' | 'interactive' | 'label' | 'related'
>;

export function GeometryPreview({
  id,
  locale = 'en',
  interactive = true,
  label,
  related = false,
}: GeometryPreviewProps) {
  const state: Record<string, number> = useMemo(() => initialState(id), [id]);
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
}: WebGPUCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mounted = useRef<IllustrationSession | null>(null);
  const latestState = useRef<Record<string, number>>(state);
  const latestAnimating = useRef(animating);
  const [error, setError] = useState('');
  latestState.current = state;
  latestAnimating.current = animating;
  useEffect(() => {
    let active = true;
    let observer: IntersectionObserver | undefined;
    const mount = () => {
      // The canvas ref is bound by the `Canvas` component before this effect runs.
      if (!canvas.current) return;
      return mountIllustration(canvas.current, id, latestState.current, { locale, interactive })
        .then((value) => {
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
    };
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
  // A card preview keeps its 16/9 box and a related illustration its own size; a lesson's viewport
  // is the one that fills the column it is given.
  const shell = preview
    ? 'geometry-3d-preview gallery-preview'
    : `flex flex-col gap-4 ${related ? 'geometry-3d-related' : 'geometry-3d-viewport'}`;
  return (
    <div className={`geometry-3d ${shell}`} data-geometry-3d={id}>
      <Canvas canvasRef={canvas} className="geometry-3d-canvas rounded-box" label={label} />
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
