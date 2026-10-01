import { hideable, overlay, panelsShown } from './overlay.ts';
import { profileLines, profiling, startProfile } from './profile.ts';
import {
  STATS_CARD,
  STATS_TERM,
  STATS_VALUE,
  statsCorners,
  watchStats,
  type StatsWorld,
} from './statsLines.ts';
import { engineStages } from './statUnit.ts';

/**
 * A card of label and value lines in a corner of the example, at the bottom left unless `corner`
 * says otherwise; what it returns replaces its lines, a value given a class (a colour) by the
 * third item of its line.
 */
export function statsCard(corner: keyof typeof statsCorners = 'bottom-left') {
  const card = document.createElement('dl');
  card.className = `${STATS_CARD} ${statsCorners[corner]}`;
  overlay().append(card);
  hideable(card);
  return (lines: readonly (readonly [string, string, string?])[]) =>
    card.replaceChildren(
      ...lines.flatMap(([label, value, tone = '']) => {
        const term = document.createElement('dt'),
          text = document.createElement('dd');
        term.className = STATS_TERM;
        term.textContent = label;
        text.className = `${STATS_VALUE} ${tone}`;
        text.textContent = value;
        return [term, text];
      }),
    );
}

/**
 * A small corner of the example, at the bottom left unless `corner` says otherwise: the frames
 * the world drew per second, the engine's counters of the last frame and where its time went, CPU
 * and GPU, as the reference engine's `stat unit` (`unitLines`), refreshed twice a second; hidden, it reads
 * nothing, while the debug mode it turns on keeps filing the engine's CPU steps. With `?profile` in the page's address, it adds each second's CPU profile
 * (`profile.ts`), also kept as `window.__profile`. What it returns stops the corner's timers.
 */
export function stats(world: StatsWorld, corner: keyof typeof statsCorners = 'bottom-left') {
  // The corner reads the engine's CPU steps, which only its debug mode files, as a development
  // build's tools: a page without the corner pays for none of it.
  if (world.diagnostic) world.diagnostic.debug = true;
  const show = statsCard(corner);
  let profiled: [string, string][] = [];
  const stopProfile = profiling()
    ? startProfile(world, (latest) => {
        Object.assign(globalThis, { __profile: latest });
        profiled = profileLines(latest);
      })
    : () => {};
  // `?profile` times the page's own frame and reads the engine's step window itself: its CPU
  // lines replace the corner's.
  const unit = !profiling();
  const stopStats = watchStats(world, show, () => profiled, {
    open: () => unit && panelsShown(),
    stages: () => engineStages(world),
  });
  return () => {
    stopStats();
    stopProfile();
  };
}
