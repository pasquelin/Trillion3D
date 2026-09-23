import type { FrameMetrics, World } from '../../../packages/sdk-browser/src/index.ts';
import type { SceneCopy } from './content.ts';
import type { Locale } from '../../content/locale.ts';

export function createSceneTelemetry(host: ParentNode, copy: SceneCopy, locale: Locale) {
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
    frame(world: World, metrics: FrameMetrics) {
      clearTimeout(idleTimer);
      const { geometryPool, geometryPoolCeiling, texturePool } = world.budget;
      text('[data-scene-selected]', format(metrics.selectedTriangles));
      text('[data-scene-drawn]', format(metrics.drawnTriangles));
      text('[data-scene-fps]', copy.unavailableMetric);
      text('[data-scene-cpu]', milliseconds(metrics.cpuFrameMs));
      text('[data-scene-gpu]', milliseconds(metrics.gpuFrameMs));
      text('[data-scene-geometry-memory]', bytes(metrics.geometryAllocationBytes));
      text(
        '[data-scene-geometry-budget]',
        `${copy.geometryMemoryDesc}: ${bytes(geometryPool)} / ${bytes(geometryPoolCeiling)}`,
      );
      text('[data-scene-texture-memory]', bytes(metrics.textureResidentBytes));
      text('[data-scene-texture-budget]', `${copy.textureMemoryDesc}: ${bytes(texturePool)}`);
      idleTimer = setTimeout(() => text('[data-scene-fps]', copy.idle), 250);
    },
    stop() {
      clearTimeout(idleTimer);
    },
  };
}
