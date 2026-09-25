// The browser limits every bench run records (#418), read in the page through the engine's own
// capability detection (`detectCapabilities`) and published in `mesure.json` and `resume.md`.
// Imported by URL in the page (`probeLimits`), by Node to run it (`readLimits`) and for the report
// (`limitsLines`): no Node module here.
import type { Page } from 'playwright';
import type * as SdkBrowser from '../witnesses/measurement.ts';

/** The numeric limits of a `GPUSupportedLimits`, by name: its attributes are enumerable. */
function numbers(limits: object) {
  const read: Record<string, number> = {};
  for (const name in limits) {
    const value = (limits as Record<string, unknown>)[name];
    if (typeof value === 'number') read[name] = value;
  }
  return read;
}

/**
 * The probe from what detection returned: WebGL2 extensions, WebGPU features, and each WebGPU
 * limit as a device gets it without asking (`default`) and as the adapter grants it. `null` for a
 * renderer the browser does not grant.
 */
export function limitsOf(
  webgl: { extensions: string[] } | null,
  webgpu: { features: ReadonlySet<string>; adapter: object; defaults: object } | null,
) {
  return {
    webgl2: webgl && {
      halfFloatColor: webgl.extensions.includes('EXT_color_buffer_half_float'),
      floatColor: webgl.extensions.includes('EXT_color_buffer_float'),
      timerQuery: webgl.extensions.includes('EXT_disjoint_timer_query_webgl2'),
    },
    webgpu: webgpu && {
      timestampQuery: webgpu.features.has('timestamp-query'),
      limits: Object.entries(numbers(webgpu.adapter)).map(([name, adapter]) => ({
        name,
        default: numbers(webgpu.defaults)[name] ?? null,
        adapter,
      })),
    },
  };
}
export type LimitsProbe = ReturnType<typeof limitsOf>;

/** Runs in the page: detects both renderers, then asks a device with no limit for the defaults. */
export async function probeLimits(sdkUrl: string): Promise<LimitsProbe> {
  const sdk = (await import(sdkUrl)) as typeof SdkBrowser;
  const canvas = document.createElement('canvas');
  const [webgl, { adapter }] = await Promise.all([
    sdk.detectCapabilities('webgl', canvas),
    sdk.detectCapabilities('webgpu', canvas),
  ]);
  // A device asked with no limit holds the defaults; one refused leaves them unknown (`null`).
  const device = await adapter?.requestDevice().catch(() => undefined);
  const probe = limitsOf(
    webgl.renderer ? webgl : null,
    adapter
      ? { features: adapter.features, adapter: adapter.limits, defaults: device?.limits ?? {} }
      : null,
  );
  device?.destroy();
  return probe;
}

/** Runs the probe in `page`, which imports this module from the bench's `/runner/`. */
export const readLimits = (page: Page, sdkUrl: string) =>
  page.evaluate(
    async ({ module, url }) =>
      ((await import(module)) as { probeLimits: typeof probeLimits }).probeLimits(url),
    { module: '/runner/limits.ts', url: sdkUrl },
  );

const yes = (value: boolean) => (value ? 'yes' : 'no');

/** The probe in `resume.md`: capabilities, then the WebGPU limits the adapter raises. */
export function limitsLines(probe: LimitsProbe | undefined) {
  if (!probe) return [];
  const { webgl2, webgpu } = probe;
  const raised = webgpu?.limits.filter((limit) => limit.adapter !== limit.default) ?? [];
  return [
    '## Browser limits',
    '',
    webgl2
      ? `- WebGL2: half-float colour ${yes(webgl2.halfFloatColor)}, float colour ${yes(webgl2.floatColor)}, EXT_disjoint_timer_query_webgl2 ${yes(webgl2.timerQuery)}`
      : '- WebGL2: unavailable',
    webgpu
      ? `- WebGPU: timestamp-query ${yes(webgpu.timestampQuery)}, ${raised.length} of ${webgpu.limits.length} limits above the default`
      : '- WebGPU: unavailable',
    '',
    ...(raised.length
      ? [
          '| WebGPU limit | default | adapter |',
          '|---|---|---|',
          ...raised.map((l) => `| ${l.name} | ${l.default ?? '—'} | ${l.adapter} |`),
          '',
        ]
      : []),
  ];
}
