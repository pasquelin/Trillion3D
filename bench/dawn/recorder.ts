// Records what a person plays on a page in their own browser, as a bench scenario the bench replays
// frame for frame (`scenario.ts`): `node bench/dawn/recorder.ts` prints a snippet to paste in the
// page's console; play, then `__rec.stop()` downloads the scenario. Times are put on the bench's
// 120 Hz clock from the events' own timestamps, so a browser that drew fewer frames records the
// same moments.
import { REFRESH_MS } from './frames.ts'

/** The snippet: listens on the page's canvas and document, numbers each event by its 120 Hz frame
 *  since the start, and turns the recording into a scenario of one segment, then a still one. */
export const RECORDER = String.raw`(() => {
  const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const t0 = performance.now(), events = [];
  const frame = (t) => Math.max(0, Math.round((t - t0) / ${REFRESH_MS}));
  const rect = () => canvas.getBoundingClientRect();
  const keys = (e) => { if (!e.repeat) events.push({ frame: frame(e.timeStamp), type: e.type, code: e.code, key: e.key }); };
  const pointer = (e) => {
    const r = rect();
    events.push({ frame: frame(e.timeStamp), type: e.type, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, buttons: e.buttons, button: e.button });
  };
  const wheel = (e) => { const r = rect(); events.push({ frame: frame(e.timeStamp), type: 'wheel', deltaY: e.deltaY, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); };
  const on = [[document, 'keydown', keys], [document, 'keyup', keys], [canvas, 'pointerdown', pointer], [canvas, 'pointermove', pointer], [canvas, 'pointerup', pointer], [canvas, 'wheel', wheel]];
  for (const [target, type, f] of on) target.addEventListener(type, f, { capture: true, passive: true });
  window.__rec = {
    events,
    stop(name = 'recorded') {
      for (const [target, type, f] of on) target.removeEventListener(type, f, { capture: true });
      const frames = frame(performance.now()) + 1;
      const page = location.pathname.split('/').pop().replace(/\.html$/, '');
      const scenario = { name, page, segments: [{ name, frames, events, capture: true }, { name: 'still', frames: 240, capture: true }] };
      const link = Object.assign(document.createElement('a'), { download: page + '-' + name + '.json', href: URL.createObjectURL(new Blob([JSON.stringify(scenario)], { type: 'application/json' })) });
      link.click();
      return events.length + ' events over ' + frames + ' frames';
    },
  };
  return 'recording: play, then __rec.stop()';
})();`

if (import.meta.main) console.log(RECORDER)
