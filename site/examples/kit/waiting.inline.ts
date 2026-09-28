import roadmap from '../../content/gallery-roadmap.json' with { type: 'json' };
import type { RoadmapEntry } from '../../app/examples/list.ts';

/** Each example parked until the engine draws it (`waiting-engine` in the gallery roadmap), by
 *  its id, and the issue it waits for. The runtime build runs this module and bundles only this
 *  map (`scripts/docs/inline-modules.ts`), not the roadmap. */
export const WAITING_ISSUES: Record<string, number> = Object.fromEntries(
  (roadmap.entries as RoadmapEntry[]).flatMap(({ id, status, issue }) =>
    status === 'waiting-engine' && issue !== undefined ? [[id, issue] as const] : [],
  ),
);
