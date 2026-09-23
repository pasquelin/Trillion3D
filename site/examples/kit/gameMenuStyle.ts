/**
 * The game menu's own rules, written into the kit's shadow layer beside the site's stylesheet:
 * a card, big buttons, keycaps. They read the colours of the layer's DaisyUI theme through its
 * custom properties, so the menu wears the portal's palette without a class of its own there.
 */
export const MENU_STYLE = `
.wg-menu { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px;
  pointer-events: auto; background: rgb(8 6 14 / 0.5); backdrop-filter: blur(4px) saturate(0.8);
  -webkit-backdrop-filter: blur(4px) saturate(0.8); }
.wg-menu[hidden] { display: none; }
.wg-card { box-sizing: border-box; width: min(100%, 420px); max-height: calc(100vh - 32px);
  overflow: auto; display: grid; gap: 14px; padding: 24px; border-radius: var(--radius-box, 1rem);
  background: color-mix(in oklab, var(--color-base-100) 92%, transparent);
  color: var(--color-base-content); box-shadow: 0 20px 60px rgb(0 0 0 / 0.5); text-align: center; }
.wg-card h1 { margin: 0; font-size: clamp(26px, 7vw, 36px); line-height: 1.1; font-weight: 800;
  color: var(--color-base-content); }
.wg-card p { margin: 0; opacity: 0.85; line-height: 1.4; }
.wg-note { color: var(--color-warning); font-weight: 600; }
.wg-note:empty, .wg-goal:empty { display: none; }
.wg-stack { display: grid; gap: 10px; }
.wg-stack[hidden], .wg-sheet[hidden] { display: none; }
.wg-button { min-height: 48px; padding: 0 18px; border: 1px solid
  color-mix(in oklab, var(--color-base-content) 20%, transparent); border-radius: var(--radius-field, 0.5rem);
  background: var(--color-base-200); color: var(--color-base-content); font: inherit;
  font-size: 17px; font-weight: 700; cursor: pointer; }
.wg-button:hover, .wg-button:focus-visible { border-color: var(--color-primary); outline: none; }
.wg-button.wg-primary { background: var(--color-primary); color: var(--color-primary-content);
  border-color: var(--color-primary); }
.wg-option { display: grid; gap: 6px; text-align: start; font-size: 14px; }
.wg-choices { display: flex; gap: 6px; }
.wg-choices .wg-button { flex: 1; min-height: 38px; font-size: 14px; }
.wg-choices .wg-on { border-color: var(--color-primary); color: var(--color-primary); }
.wg-sheet { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 16px;
  align-items: center; text-align: start; font-size: 14px; }
.wg-caps { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.wg-caps small { flex-basis: 100%; text-align: end; opacity: 0.6; font-size: 11px; }
kbd.wg-cap { min-width: 26px; padding: 3px 7px; border-radius: 6px; text-align: center;
  font: 600 13px/1.2 ui-monospace, 'SF Mono', Menlo, monospace; background: var(--color-base-300);
  border: 1px solid color-mix(in oklab, var(--color-base-content) 25%, transparent);
  border-bottom-width: 3px; }
`;

/** The page's rule the kit adds once: what a page marks `data-hud` shows only while playing. */
export const HUD_RULE = "html[data-game='menu'] [data-hud] { visibility: hidden !important; }";
