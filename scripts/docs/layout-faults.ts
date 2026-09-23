import type { Page } from 'playwright';

/** One route of each page type the portal has, after the locale. */
export const ROUTES = [
  'learn/home',
  'learn/quick-start',
  'learn/three-migration',
  'api',
  'api/createWorld',
  'api/perspectiveProjection',
  'examples',
  'examples/cube-on-its-corner',
  'lessons',
  'lessons/matrix-inverse',
  'reports',
  'nowhere',
];

/**
 * What the layout of the open page does wrong: a page wider than the screen, an element past the
 * right edge of the content area, in-flow siblings of a grid or flex box that overlap, text cut
 * without an ellipsis, uneven or wrapping header controls, a sidebar that scrolls sideways.
 */
export function layoutFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const faults: string[] = [];
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${[...element.classList].slice(0, 3).join('.')}`;
    const shown = (element: Element) => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== 'hidden';
    };
    const clips = (element: Element) =>
      /auto|scroll|hidden|clip/.test(getComputedStyle(element).overflowX);
    if (document.documentElement.scrollWidth > innerWidth)
      faults.push(
        `page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`,
      );
    if (document.documentElement.scrollHeight > innerHeight)
      faults.push(`the window scrolls (${document.documentElement.scrollHeight} > ${innerHeight})`);
    const main = document.getElementById('main-content')!;
    if (getComputedStyle(main).overflowY !== 'auto')
      faults.push('the content area does not scroll');
    const edge = main.getBoundingClientRect().right;
    for (const element of main.querySelectorAll('*')) {
      if (!shown(element)) continue;
      let clipped = false;
      for (let up = element.parentElement; up && up !== main; up = up.parentElement)
        if (clips(up)) clipped = true;
      const box = element.getBoundingClientRect();
      if (!clipped && box.width > 0 && box.right > edge + 1)
        faults.push(
          `${name(element)} passes the content edge by ${Math.round(box.right - edge)}px`,
        );
      const style = getComputedStyle(element);
      const text = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (
        text &&
        box.width > 1 &&
        /hidden|clip/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth + 1 &&
        style.textOverflow !== 'ellipsis'
      )
        faults.push(`${name(element)} cuts its text without an ellipsis`);
      if (!/grid|flex/.test(style.display)) continue;
      const children = [...element.children].filter(
        (child) => shown(child) && /static|relative|sticky/.test(getComputedStyle(child).position),
      );
      const boxes = children.map((child) => child.getBoundingClientRect());
      // Children set in one same grid cell on purpose (a hero's picture under its text) stack.
      const cell = (child: Element) => {
        const { gridRowStart, gridColumnStart } = getComputedStyle(child);
        return gridRowStart === 'auto' || gridColumnStart === 'auto'
          ? null
          : `${gridRowStart}/${gridColumnStart}`;
      };
      for (let a = 0; a < boxes.length; a++)
        for (let b = a + 1; b < boxes.length; b++) {
          const x =
            Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left);
          const y =
            Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top);
          const stacked = cell(children[a]) !== null && cell(children[a]) === cell(children[b]);
          if (x > 1 && y > 1 && !stacked)
            faults.push(`${name(children[a])} overlaps ${name(children[b])}`);
        }
    }
    const header = document.querySelector('body header')!;
    const heights = new Set(
      [...header.querySelectorAll('.btn')].filter(shown).map((button) => button.clientHeight),
    );
    if (heights.size > 1) faults.push(`header controls of heights ${[...heights]}`);
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      if (node.textContent?.trim() && range.getClientRects().length > 1)
        faults.push(`header text wraps: ${node.textContent}`);
    }
    const sidebar = document.getElementById('sidebar')!;
    if (shown(sidebar) && sidebar.scrollWidth > sidebar.clientWidth)
      faults.push(`sidebar scrolls sideways (${sidebar.scrollWidth} > ${sidebar.clientWidth})`);
    return [...new Set(faults)];
  });
}
