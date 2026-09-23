import { useEffect, useState } from 'react';
import { t } from '../../content/i18n/index.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Stat, StatGroup } from '../ui/Stats.tsx';
import type { Session } from './session.ts';

interface Reading {
  cpu: number | null;
  gpu: number | null;
  triangles: number | null;
  pages: number | null;
  sessions: number;
}

const ms = (value: number | null) => (value == null ? '—' : value.toFixed(2));
const count = (value: number | null) => (value == null ? '—' : value.toLocaleString());

/**
 * What the engine says of its last frame: CPU and GPU time, triangles drawn, pages resident, and
 * the sessions the world has opened. Read in the world's own frame hook, never on a timer: a still
 * scene draws no frame, and this panel then costs nothing either.
 */
export function EditorStats({ session }: { session: Session }) {
  const { locale } = usePortal().route;
  const [reading, setReading] = useState<Reading | null>(null);
  useEffect(() => {
    const { world } = session;
    return world.onFrame(({ metrics }) =>
      setReading({
        cpu: metrics.cpuFrameMs,
        gpu: metrics.gpuFrameMs,
        triangles: metrics.selectedTriangles ?? metrics.triangles,
        pages: metrics.residentPages,
        sessions: world.diagnostic.sessions,
      }),
    );
  }, [session]);
  const hint = t(locale, 'editor.statsHint');
  return (
    <StatGroup aria-label={t(locale, 'editor.stats')} className="w-full">
      <Stat title={t(locale, 'editor.cpu')} description={hint}>
        {ms(reading?.cpu ?? null)}
      </Stat>
      <Stat title={t(locale, 'editor.gpu')}>{ms(reading?.gpu ?? null)}</Stat>
      <Stat title={t(locale, 'editor.triangles')}>{count(reading?.triangles ?? null)}</Stat>
      <Stat title={t(locale, 'editor.pages')}>{count(reading?.pages ?? null)}</Stat>
      <Stat title={t(locale, 'editor.sessions')}>{reading?.sessions ?? '—'}</Stat>
    </StatGroup>
  );
}
