import { foldPanels, overlay } from './overlay.ts';
import { HUD_RULE, MENU_STYLE } from './gameMenuStyle.ts';

/**
 * A game's menu, drawn over its paused frame: the start screen before the first play, the pause
 * screen after, and the key sheet either one opens. It only draws and reports what is pressed;
 * `play.ts` decides when it shows. While it shows, whatever the page marks `data-hud` is hidden,
 * so the frame carries one message at a time.
 */

/** One line of the key sheet: what it does, its keys, and theirs on an AZERTY keyboard. */
export interface GameKey {
  action: string;
  keys: string[];
  azerty?: string[];
}

/** A choice the page offers before playing, `value` being the one it starts on. */
export interface GameOption {
  id: string;
  label: string;
  choices: string[];
  value?: string;
}

/** The menu's words, in the page's language. */
export interface MenuLabels {
  play: string;
  resume: string;
  restart: string;
  controls: string;
  back: string;
  paused: string;
  again: string;
}

export const MENU_LABELS: MenuLabels = {
  play: 'Play',
  resume: 'Resume',
  restart: 'Restart',
  controls: 'Controls',
  back: 'Back',
  paused: 'Paused',
  again: 'Click again to continue',
};

/** What the menu shows and says. */
export interface MenuSpec {
  title: string;
  goal: string;
  keys: GameKey[];
  options: GameOption[];
  labels: MenuLabels;
}

/** What a press on the menu asks of the game. */
export interface MenuActions {
  play(): void;
  restart(): void;
  option(id: string, value: string): void;
}

/** The start screen, the pause screen, or none while playing. */
type Screen = 'start' | 'pause' | null;

export interface MenuView {
  /** Shows `screen`, with `note` under its title (a refused lock); `null` hides the menu. */
  show(screen: Screen, note?: string): void;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};

const button = (text: string, press: () => void, primary = false) => {
  const element = make('button', primary ? 'wg-button wg-primary' : 'wg-button', text);
  element.type = 'button';
  element.onclick = press;
  return element;
};

/** One keycap per key; the AZERTY keys, when they differ, on a line of their own. */
function keycaps({ keys, azerty }: GameKey) {
  const caps = make('div', 'wg-caps');
  caps.append(...keys.map((key) => make('kbd', 'wg-cap', key)));
  if (azerty)
    caps.append(make('small', '', 'AZERTY'), ...azerty.map((key) => make('kbd', 'wg-cap', key)));
  return caps;
}

/** One option: its label, then its choices side by side, the current one marked. */
function choice(option: GameOption, chosen: (value: string) => void) {
  const row = make('div', 'wg-option', option.label),
    choices = make('div', 'wg-choices');
  let value = option.value ?? option.choices[0];
  const mark = () => {
    for (const [index, element] of [...choices.children].entries())
      element.classList.toggle('wg-on', option.choices[index] === value);
  };
  choices.append(
    ...option.choices.map((next) => button(next, () => ((value = next), mark(), chosen(next)))),
  );
  mark();
  row.append(choices);
  return row;
}

/** Builds the menu into the kit's layer, under its panels, and returns its switch. */
export function createMenu(spec: MenuSpec, actions: MenuActions): MenuView {
  const layer = overlay(),
    root = layer.getRootNode() as ShadowRoot;
  const style = make('style');
  style.textContent = MENU_STYLE;
  root.prepend(style);
  const hud = document.createElement('style');
  hud.textContent = HUD_RULE;
  document.head.append(hud);
  const { labels } = spec;
  const menu = make('div', 'wg-menu'),
    card = make('div', 'wg-card');
  const heading = make('h1'),
    goal = make('p', 'wg-goal', spec.goal),
    note = make('p', 'wg-note');
  const main = make('div', 'wg-stack'),
    sheet = make('div', 'wg-sheet'),
    back = make('div', 'wg-stack');
  const primary = button(labels.play, () => actions.play(), true);
  const restart = button(labels.restart, () => actions.restart());
  const flip = (keys: boolean) => {
    [main.hidden, sheet.hidden, back.hidden] = [keys, !keys, !keys];
    // The first button takes the focus: Enter or Space presses it, as in a game's menu.
    ((keys ? back.firstElementChild : primary) as HTMLElement | null)?.focus({
      preventScroll: true,
    });
  };
  main.append(
    primary,
    restart,
    button(labels.controls, () => flip(true)),
    ...spec.options.map((option) => choice(option, (value) => actions.option(option.id, value))),
  );
  for (const key of spec.keys) sheet.append(make('span', '', key.action), keycaps(key));
  back.append(button(labels.back, () => flip(false)));
  card.append(heading, goal, note, main, sheet, back);
  menu.append(card);
  // First in the layer: the settings panel and the counters are drawn over the menu's veil.
  layer.prepend(menu);
  foldPanels();
  return {
    show(screen, words = '') {
      document.documentElement.dataset.game = screen ? 'menu' : 'playing';
      menu.hidden = !screen;
      if (!screen) return foldPanels();
      const paused = screen === 'pause';
      heading.textContent = paused ? labels.paused : spec.title;
      goal.hidden = paused;
      note.textContent = words;
      primary.textContent = paused ? labels.resume : labels.play;
      restart.hidden = !paused;
      flip(false);
    },
  };
}
