import type { WebgpuTileAtlas } from './webgpuTileAtlas.ts';
import type { WebgpuTileFeedback } from './webgpuTileFeedback.ts';
import type { TileKey } from './webgpuTilePageTable.ts';
import type { TileCounters } from './webgpuTileCounters.ts';

export type TileRequest = { atlas: WebgpuTileAtlas; key: TileKey; weight: number };

/**
 * What a pass has to serve: the tiles the last image feedback named, most looked-at first, or —
 * when no feedback has come back since — what the previous pass left unserved under its budget.
 *
 * A budget defers tiles, it never drops them: the remainder of a pass is kept in weight order and
 * offered again to the next pass, until fresh feedback replaces it. Fresh feedback always wins,
 * since it names what the image looks at now; a deferred tile still looked at is named again
 * within a feedback cycle, one no longer looked at would be work for nothing. A replay places its
 * tiles at the frame of the feedback that named them (`frame`): the pool then yields exactly what
 * that pass would have yielded, never a tile a later image has looked at.
 */
export function createTileRequests(options: {
  feedback: WebgpuTileFeedback;
  color: WebgpuTileAtlas;
  data: WebgpuTileAtlas;
  counters: TileCounters;
}) {
  const { feedback, color, data, counters } = options;
  let backlog: TileRequest[] = [],
    named = 0;
  /** Tiles the last image feedback names, resident ones touched along the way. */
  const fromFeedback = (counts: Uint32Array, frame: number) => {
    const out: TileRequest[] = [];
    let requested = 0,
      atLevel = 0,
      gap = 0;
    for (let index = 0; index < counts.length; index++) {
      const weight = counts[index];
      if (!weight) continue;
      const atlas = index < color.pages.entries ? color : data;
      const key = atlas.pages.tileOf(index);
      requested++;
      const served = atlas.servedLevel(key) - key.level;
      if (served === 0) atLevel++;
      gap += served;
      if (!atlas.touch(key, frame)) out.push({ atlas, key, weight });
    }
    counters.requested = requested;
    counters.atLevel = atLevel;
    counters.missingAverage = requested ? gap / requested : 0;
    return out.sort((a, b) => b.weight - a.weight);
  };
  return {
    /** The list a pass serves, in weight order; empty when nothing is named or deferred. */
    take(frame: number): TileRequest[] {
      const counts = feedback.take();
      if (!counts) return backlog;
      named = frame;
      return fromFeedback(counts, frame);
    },
    /** Frame of the feedback the list came from: where a pass places what it serves. */
    get frame() {
      return named;
    },
    /** What the pass did not reach: offered again to the next pass. */
    defer(wanted: TileRequest[], from: number) {
      backlog = from < wanted.length ? wanted.slice(from) : [];
    },
    /** Tiles waiting for a next pass, deferred by the budget. */
    get deferred() {
      return backlog.length;
    },
  };
}
