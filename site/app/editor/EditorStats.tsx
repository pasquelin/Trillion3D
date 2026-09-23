import { useEffect, useState } from 'react';
import {
  STATS_CARD,
  STATS_TERM,
  STATS_VALUE,
  statsCorners,
  watchStats,
} from '../../examples/kit/statsLines.ts';
import type { Session } from './session.ts';

/**
 * The examples' stats corner, over the editor's view: the frames the world drew per second and
 * the engine's counters of its last frame — triangles, draw calls, pages, pool — read twice a
 * second. A still scene draws no frame, and the corner then keeps its last reading.
 */
export function EditorStats({ session }: { session: Session }) {
  const [lines, setLines] = useState<[string, string][]>([]);
  useEffect(() => {
    const stop = watchStats(session.world, setLines);
    return stop;
  }, [session]);
  if (lines.length === 0) return null;
  return (
    <dl className={`${STATS_CARD} ${statsCorners['bottom-left']} z-10`}>
      {lines.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className={STATS_TERM}>{label}</dt>
          <dd className={STATS_VALUE}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
