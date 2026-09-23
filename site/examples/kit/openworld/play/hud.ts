import { overlay } from '../../overlay.ts';
import { HINTS } from './keys.ts';
import { minimap } from './minimap.ts';
import type { Mode, Road } from './types.ts';

/**
 * The heads-up display, on the kit's overlay layer: the mode and the speed, then on
 * foot the stamina, in the plane the altitude and the throttle (nothing more in the car), what the E key would do here, the keys of the mode, and the map.
 */
export type HudState = {
  mode: Mode;
  /** m/s. */
  speed: number;
  /** Metres above the sea, and above the ground when the ground is known. */
  altitude: number;
  aboveGround: number | null;
  stamina: number;
  throttle: number;
  stalled: boolean;
  loading: boolean;
  /** What the E key does here, or nothing. */
  prompt: string | null;
  x: number;
  z: number;
  heading: number;
};

export type Hud = { update(state: HudState): void; dispose(): void };

const LABEL: Record<Mode, string> = {
  foot: 'On foot',
  car: 'Car',
  plane: 'Plane',
};

/** The readings as lines of text: pure, so the wording is tested. */
export function readings(state: HudState): string[] {
  const lines = [`${LABEL[state.mode]} · ${Math.round(state.speed * 3.6)} km/h`];
  if (state.mode === 'foot') lines.push(`Stamina ${Math.round(state.stamina * 100)} %`);
  if (state.mode === 'plane') {
    const ground =
      state.aboveGround === null ? '' : ` · ${Math.round(state.aboveGround)} m above ground`;
    lines.push(`Altitude ${Math.round(state.altitude)} m${ground}`);
    lines.push(`Throttle ${Math.round(state.throttle * 100)} %${state.stalled ? ' · STALL' : ''}`);
  }
  if (state.loading) lines.push('Loading the ground here…');
  return lines;
}

export function hud(roads: readonly Road[], size: number): Hud {
  const box = document.createElement('div');
  box.className =
    'pointer-events-none absolute top-3 left-3 flex max-w-xs flex-col gap-0.5 rounded-box bg-base-100/60 px-3 py-2 text-xs leading-5 backdrop-blur';
  const lines = document.createElement('div');
  lines.className = 'whitespace-pre-line font-medium tabular-nums';
  const prompt = document.createElement('p');
  prompt.className = 'font-semibold text-primary';
  const keys = document.createElement('p');
  keys.className = 'text-[11px] opacity-70';
  box.append(lines, prompt, keys);
  const map = minimap(roads, size);
  map.element.classList.add('pointer-events-none', 'absolute', 'bottom-3', 'right-3');
  overlay().append(box, map.element);
  let last = '';
  let drawn = 0;
  return {
    update(state) {
      const text = [...readings(state), state.prompt ?? '', HINTS[state.mode]].join('\n');
      if (text !== last) {
        last = text;
        lines.replaceChildren(
          ...readings(state).map((line) =>
            Object.assign(document.createElement('div'), { textContent: line }),
          ),
        );
        prompt.textContent = state.prompt ?? '';
        prompt.hidden = !state.prompt;
        keys.textContent = HINTS[state.mode];
      }
      // The map moves slowly on screen: ten redraws a second are enough.
      const now = performance.now();
      if (now - drawn > 100) {
        drawn = now;
        map.draw(state.x, state.z, state.heading);
      }
    },
    dispose() {
      box.remove();
      map.element.remove();
    },
  };
}
