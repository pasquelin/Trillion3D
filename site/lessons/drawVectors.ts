import { add, legend, line, text } from './drawPrimitives.ts';
import type { SvgHost } from './drawPrimitives.ts';
import type { VectorsResult, NormalizeResult } from './evaluate.ts';

export function drawVectors(
  svg: SvgHost,
  result: VectorsResult | NormalizeResult,
  french: boolean,
) {
  if (result.kind === 'normalize') {
    const vectors: [Float64Array, string, string][] = [
      [result.before, '#94a3b8', french ? 'avant' : 'before'],
      [result.after, '#7c3aed', french ? 'direction unité' : 'unit direction'],
    ];
    vectors.forEach(([v, color]) => {
      line(svg, 320, 160, 320 + v[0] * 42, 160 - v[1] * 42, color, 5);
    });
    legend(
      svg,
      vectors.map(([, color, label]) => ({ color, label })),
    );
    return;
  }
  const pair: [number[], string, string][] = [
    [result.a, '#2563eb', 'a'],
    [result.b, '#f97316', 'b'],
  ];
  pair.forEach(([v, color]) => {
    line(svg, 320, 160, 320 + v[0] * 105, 160 - v[1] * 105, color, 5);
  });
  legend(svg, [
    { color: '#2563eb', label: 'a' },
    { color: '#f97316', label: 'b' },
  ]);
  if ('cross' in result) {
    add(svg, 'circle', {
      cx: 320,
      cy: 160,
      r: 34,
      fill: 'none',
      stroke: result.cross >= 0 ? '#22c55e' : '#ef4444',
      'stroke-width': 5,
      'stroke-dasharray': '8 5',
    });
    const turn =
      result.cross >= 0
        ? french
          ? 'antihoraire ↺'
          : 'counter-clockwise ↺'
        : french
          ? 'horaire ↻'
          : 'clockwise ↻';
    text(svg, 320, 215, turn, 'middle');
  } else {
    const width = Math.max(2, Math.abs(result.dot) * 18);
    line(svg, 90, 275, 550, 275, '#cbd5e1', 10);
    line(
      svg,
      320,
      275,
      320 + result.dot * 210,
      275,
      result.dot >= 0 ? '#22c55e' : '#ef4444',
      width,
    );
    text(svg, 90, 300, french ? '−1 opposés' : '−1 opposed');
    text(svg, 550, 300, french ? '+1 alignés' : '+1 aligned', 'end');
  }
}
