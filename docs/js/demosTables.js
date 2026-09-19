/**
 * The enum pages show the engine's own tables, read from the bundle at load time: what the
 * page displays cannot drift from what the engine holds, because it is the same object.
 */
import {
  COLUMN_KIND,
  DIAGNOSTICS,
  IDENTITY_MATRIX4,
  LOD_QUALITY,
  MATH_PATH_CONTRACT,
  adaptivePixelError,
  createPathGovernor,
  lodQuality,
} from './engine.js';
import { formatNumber, matrixView, slider, valueView, verdictView } from './demoKit.js';

export const TABLE_DEMOS = {
  IDENTITY_MATRIX4: {
    run() {
      return [
        matrixView(
          'the constant itself, read from the engine',
          IDENTITY_MATRIX4,
          'read and never written',
        ),
      ];
    },
  },
  DiagnosticMode: {
    run() {
      return [
        valueView(
          'DIAGNOSTICS — the engine says which modes it can produce, and why not',
          Object.entries(DIAGNOSTICS).map(([mode, capability]) => [
            mode,
            `${capability.available ? 'available' : 'unavailable'} — ${capability.reason}`,
          ]),
        ),
      ];
    },
  },
  LodQualityId: {
    controls: [
      slider('speed', 'camera speed (m/s)', 0, 40, 0, 0.5),
      slider('radius', 'radius of what is on screen (m)', 1, 200, 30, 1),
    ],
    run(state) {
      const rows = Object.values(LOD_QUALITY).map((quality) => [
        quality.id,
        `${quality.label} — pixelError ${quality.pixelError}, anisotropy ${quality.anisotropy}${quality.adaptive ? ', adaptive' : ''}`,
      ]);
      const base = lodQuality('adaptive').pixelError;
      const adapted = adaptivePixelError(base, state.speed, state.radius);
      return [
        valueView('LOD_QUALITY, as the engine holds it', rows),
        valueView('adaptivePixelError(base, speed, radius) on the adaptive preset', [
          ['base', formatNumber(base)],
          ['threshold at this speed', formatNumber(adapted)],
          ['note', 'a still view keeps the base; a moving view may coarsen'],
        ]),
      ];
    },
  },
  MathPathMode: {
    controls: [
      slider('js', 'JS nanoseconds per element', 1, 200, 80, 1),
      slider('wasm', 'Wasm nanoseconds per element', 1, 200, 40, 1),
      slider('runs', 'executions observed', 1, 40, 12, 1),
    ],
    run(state) {
      const governor = createPathGovernor(() => performance.now(), 'auto');
      governor.setWasm(true, true, null);
      const elements = 1000;
      for (let run = 0; run < Math.round(state.runs); run++) {
        governor.observe('demo', 'js', (state.js * elements) / 1e6, elements);
        governor.observe('demo', 'wasm', (state.wasm * elements) / 1e6, elements);
      }
      const metrics = governor.metrics();
      const operation = metrics.operations.demo ?? {};
      return [
        valueView('the governor, after those executions', [
          ['contract version', String(MATH_PATH_CONTRACT)],
          ['path chosen', String(operation.path ?? 'not decided yet')],
          ['jsNsPerElement', formatNumber(operation.jsNsPerElement ?? Number.NaN)],
          ['wasmNsPerElement', formatNumber(operation.wasmNsPerElement ?? Number.NaN)],
          ['switches', String(operation.switches ?? 0)],
          [
            'clock resolution the measurement rests on (ms)',
            formatNumber(metrics.clockResolutionMs),
          ],
        ]),
        verdictView(
          'arbitration',
          operation.path === 'wasm',
          operation.path === 'wasm'
            ? 'the kernel leads by enough, for long enough, to be worth the switch'
            : 'JS keeps the work: under five samples, or the lead is not a burst',
        ),
      ];
    },
  },
  ColumnKind: {
    run() {
      const kinds = {};
      for (const [column, kind] of Object.entries(COLUMN_KIND)) (kinds[kind] ??= []).push(column);
      return [
        valueView(
          'COLUMN_KIND — every column of the binary manifest, by storage',
          Object.entries(kinds).map(([kind, columns]) => [kind, columns.join(', ')]),
        ),
      ];
    },
  },
};
