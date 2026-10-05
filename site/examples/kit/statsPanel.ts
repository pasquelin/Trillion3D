import { cadenceRows } from './cadence.ts';
import { fillRows, make, makeLegend, put, setClass } from './statsDom.ts';
import { bindGestures } from './statsGestures.ts';
import { loadLayout, saveLayout, sizeClass, type StatsCorner } from './statsLayout.ts';
import { shadowCounters, type StatsSample, type StatsWorld } from './statsLines.ts';
import {
  cpuRows,
  gpuRows,
  sceneRows,
  say,
  SECTIONS,
  sectionTotal,
  shadowRows,
  type Row,
  type SectionId,
} from './statsRows.ts';
import { sparkline, tone } from './statsSpark.ts';
import { STYLE } from './statsStyle.ts';
import { watchStats, type CpuSource } from './statsWatch.ts';
import { kitWord } from './words.ts';

/**
 * The profiler overlay of the examples and the scene editor: a header line (frames a second and the frame's time against the 120 Hz
 * budget), a sparkline of the last frames' CPU and GPU times, then one folding section each for
 * the display's cadence (`cadence.ts`), the CPU stages, the GPU passes by cost, the virtual shadow maps and the scene and memory
 * counters. Every value the corner reads (`statsLines.ts`) is shown, only grouped.
 *
 * It scales with the view (its font and width follow the viewport, never more than about 30% of
 * it), starts folded on a small view and down to its header line on a phone; a click on the
 * header, or the key left of 1, folds it to that line; a drag on the header moves it to another
 * corner. Folds and corner are kept per viewer and per view size (`localStorage`). Its numbers
 * change four times a second; a frame only writes its two times into fixed rings.
 */

/** How often the numbers change. */
const PERIOD_MS = 250;

/**
 * The profiler overlay over `parent`, watching `world`: at `corner` unless the viewer moved it.
 * `cpu` and `extra` are `watchStats`'s. Returns the panel and what stops it.
 */
export function statsPanel(
  world: StatsWorld,
  parent: HTMLElement,
  options: {
    corner?: StatsCorner;
    cpu?: CpuSource;
    extra?: () => [string, string][];
  } = {},
) {
  // The frame covers the view the panel sits on: its size, not the parent's (whose own may wait
  // on a stylesheet), decides the size class.
  const area = make('div', 't3s-frame');
  const style = make('style');
  style.textContent = STYLE;
  area.append(style);
  parent.append(area);
  const size = sizeClass(area);
  const layout = loadLayout(size, options.corner ?? 'bottom-left');
  const panel = make('section', 't3s');
  panel.dataset.stats = '';
  panel.dataset.corner = layout.corner;
  panel.setAttribute('aria-label', say('Statistics'));
  panel.toggleAttribute('data-empty', true);

  const head = make('div', 't3s-head');
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  head.title = kitWord('stats', 'hint', 'Click: compact · drag: move · key ` / ²');
  const dot = make('span', 't3s-dot'),
    fps = make('b', 't3s-big'),
    fpsUnit = make('span', 't3s-u', say('fps')),
    frame = make('b'),
    frameUnit = make('span', 't3s-u', 'ms'),
    held = make('span', 't3s-tag'),
    cg = make('span', 't3s-cg'),
    cpuHead = make('b'),
    gpuHead = make('b');
  cg.append('CPU ', cpuHead, ' · GPU ', gpuHead, ' ms');
  head.append(dot, fps, fpsUnit, frame, frameUnit, held, cg);

  const body = make('div', 't3s-body');
  const sparkCanvas = make('canvas', 't3s-spark');
  const legend = makeLegend(say('budget'));
  body.append(sparkCanvas, legend);

  const sections = new Map<
    SectionId,
    { box: HTMLElement; name: HTMLElement; total: HTMLElement; unit: HTMLElement }
  >();
  for (const [id, title] of SECTIONS) {
    const section = make('div', 't3s-sec'),
      button = make('button', 't3s-sh'),
      total = make('span'),
      unit = make('span'),
      box = make('div', 't3s-rows');
    button.type = 'button';
    const name = make('span', '', say(title));
    button.append(name, total, unit);
    button.setAttribute('aria-expanded', String(layout.open[id]));
    box.hidden = !layout.open[id];
    button.addEventListener('click', () => {
      layout.open[id] = !layout.open[id];
      button.setAttribute('aria-expanded', String(layout.open[id]));
      box.hidden = !layout.open[id];
      saveLayout(size, layout);
      redraw();
    });
    section.hidden = true;
    section.append(button, box);
    body.append(section);
    sections.set(id, { box, name, total, unit });
  }
  panel.append(head, body);
  area.append(panel);

  // The last sample the watch read: what a fold or an unfold shows again without a new one.
  let latest: StatsSample | undefined;
  const open = () => !layout.compact;
  const spark = sparkline(world, sparkCanvas, () => !panel.hidden && open());

  // Folding a section or the panel writes nothing of its own: it shows the last sample again.
  const render = (sample: StatsSample) => {
    const frameMs = sample.fps ? 1000 / sample.fps : null;
    const colour = tone(frameMs);
    setClass(dot, `t3s-dot ${colour}`);
    put(fps, sample.fps == null ? '–' : String(Math.round(sample.fps)));
    put(frame, frameMs == null ? '–' : frameMs.toFixed(2));
    setClass(frame, colour);
    put(held, sample.held ? say('held') : '');
    put(cpuHead, sample.cpu?.frameMs != null ? sample.cpu.frameMs.toFixed(2) : '–');
    // The head reads the GPU time the image carries: none while it is held, nor between a held
    // image and the device's next sample; the last one measured is the GPU section's, marked last.
    const gpuMs = sample.held || sample.gpuFrameLast ? null : sample.gpuFrameMs;
    put(gpuHead, gpuMs != null ? gpuMs.toFixed(2) : '–');
    setClass(gpuHead, tone(gpuMs ?? null));
    panel.removeAttribute('data-empty');
    // Folded to the head: no section is shown, so none is formatted.
    if (!open()) return;
    const counters = shadowCounters(sample);
    const rows: Record<SectionId, () => Row[]> = {
      cadence: () => cadenceRows(sample.cadence, sample.gpuIdleMs),
      cpu: () => cpuRows(sample, options.extra?.() ?? []),
      gpu: () => gpuRows(sample),
      shadows: () => shadowRows(sample, counters),
      scene: () => sceneRows(sample),
    };
    for (const [id, { box, name, total, unit }] of sections) {
      // A GPU time kept from an earlier frame is marked as the last one measured.
      if (id === 'gpu') put(name, sample.gpuFrameLast ? `GPU · ${say('last')}` : 'GPU');
      const [sum, measure] = sectionTotal(id, sample, counters);
      put(total, sum);
      put(unit, measure);
      // A folded section shows its header and its total: its rows are built only to know whether
      // it has any, and only when its total does not already say so.
      if (layout.open[id]) {
        const wanted = rows[id]();
        box.parentElement!.hidden = wanted.length === 0 && !sum;
        fillRows(box, id, wanted);
      } else box.parentElement!.hidden = !sum && rows[id]().length === 0;
    }
  };
  const show = (sample: StatsSample) => {
    latest = sample;
    render(sample);
    spark.draw();
  };
  const redraw = () => {
    if (latest) show(latest);
  };

  const setCompact = (compact: boolean) => {
    layout.compact = compact;
    panel.toggleAttribute('data-compact', compact);
    saveLayout(size, layout);
    redraw();
  };
  panel.toggleAttribute('data-compact', layout.compact);
  const toggle = () => setCompact(!layout.compact);

  // A click folds; a drag of more than a few pixels moves the panel to the nearest corner.
  const unbind = bindGestures(head, panel, area, layout, toggle, () => saveLayout(size, layout));

  const stopStats = watchStats(world, show, options.cpu, PERIOD_MS, () => !panel.hidden);
  return {
    panel,
    stop() {
      stopStats();
      spark.stop();
      unbind();
      area.remove();
    },
  };
}
