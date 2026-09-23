/**
 * The layer the example kit draws on: one element over the whole page, whose shadow root holds
 * the site's stylesheet and the dark theme, so the panel wears the portal's DaisyUI components and
 * neither the example's own styles nor the kit's leak into the other.
 */
let layer: HTMLElement | undefined;

/** The shadow layer's container, created on first use; the controls panel is appended to it. */
export function overlay(): HTMLElement {
  if (layer) return layer;
  const host = document.createElement('div');
  host.dataset.exampleOverlay = '';
  // Hidden until the stylesheet arrives, so no unstyled panel flashes over the render.
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden';
  const root = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = new URL('../css/site.css', import.meta.url).href;
  sheet.onload = sheet.onerror = () => host.style.removeProperty('visibility');
  layer = document.createElement('div');
  layer.dataset.theme = 'dim';
  layer.className = 'pointer-events-none fixed inset-0 bg-transparent font-sans text-base-content';
  root.append(sheet, layer);
  document.body.append(host);
  return layer;
}

/** Whether the hosting page shows the panels, and the panels it applies to. Listened for from
 * the kit's import, before the example runs: a page posts its choice when the frame loads, which
 * an example that builds its panel after an `await` would otherwise miss. */
let visible = true;
const panels = new Set<HTMLElement>();
// A page, not a test importing the kit in Node, has messages to hear.
globalThis.addEventListener?.('message', (event) => {
  const data = event.data as { type?: unknown; visible?: unknown } | null;
  if (event.source !== parent || data?.type !== 'wg:controls') return;
  visible = Boolean(data.visible);
  for (const panel of panels) panel.hidden = !visible;
});

/** Whether a game's menu owns the frame: its panels then start folded, one click away. */
let folded = false;

/** Puts `panel` under the page's show/hide message, in its current state. */
export function hideable(panel: HTMLElement) {
  panels.add(panel);
  panel.hidden = !visible;
  if (folded) panel.removeAttribute('open');
}

/** Folds every panel, and every panel still to come, down to its title: a game's menu and its
 * play keep the frame to themselves, the settings one click away. */
export function foldPanels() {
  folded = true;
  for (const panel of panels) panel.removeAttribute('open');
}
