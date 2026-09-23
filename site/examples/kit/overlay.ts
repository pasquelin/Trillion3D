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
