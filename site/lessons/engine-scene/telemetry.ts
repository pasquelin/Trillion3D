import type { FrameMetrics } from '../../../packages/sdk/index.ts';
import type { EngineCopy } from './content.ts';
import type { Locale } from '../../content/locale.ts';

export function createSceneTelemetry(host: ParentNode, copy: EngineCopy, locale: Locale) {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const format = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(locale) : '—';
  const milliseconds = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `${value.toFixed(2)} ms`
      : copy.unavailableMetric;
  const bytes = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `${(value / (1024 * 1024)).toFixed(1)} MiB`
      : copy.unavailableMetric;
  const text = (selector: string, value: string) => {
    const node = host.querySelector<HTMLElement>(selector)!; // the scene template always renders this node
    node.textContent = value;
  };
  return {
    frame(metrics: FrameMetrics) {
      clearTimeout(idleTimer);
      text('[data-scene-selected]', format(metrics.selectedTriangles));
      text('[data-scene-drawn]', format(metrics.drawnTriangles));
      text('[data-scene-fps]', copy.unavailableMetric);
      text('[data-scene-cpu]', milliseconds(metrics.cpuFrameMs));
      text('[data-scene-gpu]', milliseconds(metrics.gpuFrameMs));
      text('[data-scene-geometry-memory]', bytes(metrics.geometryPoolAllocatedBytes));
      text(
        '[data-scene-geometry-budget]',
        `${copy.geometryMemoryDesc}: ${bytes(metrics.geometryPoolBytes)}`,
      );
      text('[data-scene-texture-memory]', bytes(metrics.textureResidentBytes));
      text(
        '[data-scene-texture-budget]',
        `${copy.textureMemoryDesc}: ${bytes(metrics.texturePoolBytes)}`,
      );
      idleTimer = setTimeout(() => text('[data-scene-fps]', copy.idle), 250);
    },
    stop() {
      clearTimeout(idleTimer);
    },
  };
}
