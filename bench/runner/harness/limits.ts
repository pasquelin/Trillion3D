// The browser limits every bench run records, read in the page through the engine's own
// capability detection (`detectCapabilities`) and published in `measure.json` and `resume.md`.
// Imported by URL in the page (`probeLimits`), by Node to run it (`readLimits`) and for the report
// (`limitsLines`): no Node module here.
import type { Page } from 'playwright'
import type * as SdkBrowser from '../../witnesses/measurement.ts'

/** The numeric limits of a `GPUSupportedLimits`, by name: its attributes are enumerable. */
function numbers(limits: object) {
  const read: Record<string, number> = {}
  for (const name in limits) {
    const value = (limits as Record<string, unknown>)[name]
    if (typeof value === 'number') read[name] = value
  }
  return read
}

/**
 * The probe from what detection returned: WebGPU features, and each WebGPU limit as a device gets
 * it without asking (`default`) and as the adapter grants it. `null` when the browser grants no
 * adapter.
 */
export function limitsOf(
  webgpu: { features: ReadonlySet<string>; adapter: object; defaults: object } | null,
) {
  if (!webgpu) return null
  const defaults = numbers(webgpu.defaults)
  return {
    timestampQuery: webgpu.features.has('timestamp-query'),
    limits: Object.entries(numbers(webgpu.adapter)).map(([name, adapter]) => ({
      name,
      default: defaults[name] ?? null,
      adapter,
    })),
  }
}
export type LimitsProbe = ReturnType<typeof limitsOf>
/** What a run records: the probe, or why it failed. */
export type LimitsRecord = LimitsProbe | { failed: string }

/** Runs in the page: detects the adapter, then asks a device with no limit for the defaults. */
export async function probeLimits(sdkUrl: string): Promise<LimitsProbe> {
  const sdk = (await import(sdkUrl)) as typeof SdkBrowser
  const { adapter } = await sdk.detectCapabilities()
  // A device asked with no limit holds the defaults; one refused leaves them unknown (`null`).
  const device = await adapter?.requestDevice().catch(() => undefined)
  const probe = limitsOf(
    adapter
      ? { features: adapter.features, adapter: adapter.limits, defaults: device?.limits ?? {} }
      : null,
  )
  device?.destroy()
  return probe
}

/** Runs the probe in `page`, which imports this module from the bench's `/runner/`. */
export const readLimits = (page: Page, sdkUrl: string): Promise<LimitsRecord> =>
  page
    .evaluate(
      async ({ module, url }) =>
        ((await import(module)) as { probeLimits: typeof probeLimits }).probeLimits(url),
      { module: '/runner/harness/limits.ts', url: sdkUrl },
    )
    .catch((error: unknown) => ({ failed: String(error) }))

const yes = (value: boolean) => (value ? 'yes' : 'no')

/** The probe in `resume.md`: capabilities, then the adapter's WebGPU limits beyond the default. */
export function limitsLines(probe: LimitsRecord | undefined) {
  if (probe === undefined) return []
  // A failed probe is said, never fatal: the run it rides with goes on.
  if (probe && 'failed' in probe)
    return ['## Browser limits', '', `Probe failed: ${probe.failed}`, '']
  // An unknown default (the device was refused) is not counted as raised.
  const raised = probe?.limits.filter((l) => l.default !== null && l.adapter !== l.default) ?? []
  return [
    '## Browser limits',
    '',
    probe
      ? `- WebGPU: timestamp-query ${yes(probe.timestampQuery)}, ${raised.length} of ${probe.limits.length} limits beyond the default`
      : '- WebGPU: unavailable',
    '',
    ...(raised.length
      ? [
          '| WebGPU limit | default | adapter |',
          '|---|---|---|',
          ...raised.map((l) => `| ${l.name} | ${l.default} | ${l.adapter} |`),
          '',
        ]
      : []),
  ]
}
