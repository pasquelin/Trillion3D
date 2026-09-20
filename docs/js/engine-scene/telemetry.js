export function createSceneTelemetry(host, copy, locale) {
  let idleTimer;
  const format = (value) => (Number.isFinite(value) ? value.toLocaleString(locale) : '—');
  const milliseconds = (value) =>
    Number.isFinite(value) ? `${value.toFixed(2)} ms` : copy.unavailableMetric;
  const bytes = (value) =>
    Number.isFinite(value) ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : copy.unavailableMetric;
  const text = (selector, value) => {
    host.querySelector(selector).textContent = value;
  };
  return {
    frame(metrics) {
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
