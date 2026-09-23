/**
 * A page's source made runnable as an iframe's `srcdoc`, its links resolved from `file`: a
 * `<base>` first in its head makes `../runtime/engine.js` and `../assets/` load as they do from
 * the file. A relative `href` resolves against the hosting page, as the file's own address does.
 */
export function srcdocFor(source: string, file: string) {
  const base = `<base href="${file}">`;
  return /<head[^>]*>/i.test(source)
    ? source.replace(/<head[^>]*>/i, (head) => `${head}${base}`)
    : `${base}${source}`;
}

/** A module script alone, as a page that runs it on a full-size `<canvas id="view">`. */
export const scriptPage = (script: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#0e1621}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="view"></canvas><script type="module">${script}</script></body></html>`;
