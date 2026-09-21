import type { ReportCanvas, ReportSource, SourceReadingRecord } from './types.ts';

interface SourceSideMeasurement {
  moteur?: string;
  canvas?: ReportCanvas | null;
}

interface SourceSeriesEntry {
  view?: string;
  pixelError?: number;
  sides?: Record<string, SourceSideMeasurement>;
}

/** The shape scripts/mesure/serie.mjs writes to each run's own measurement file; unlike report.json
 * this is fetched raw and never runs through `assertReport`, so it is trusted, not validated. */
interface SourceData {
  scene?: string;
  series: SourceSeriesEntry[];
}

export function readingGroups(sources: ReportSource[]) {
  const groups = new Map<string, SourceReadingRecord[]>();
  for (const { run, data } of sources) {
    // The only place this per-run raw JSON is inspected: see the SourceData comment above.
    const { series, ...metadata } = data as SourceData;
    for (const [index, entry] of (series.length ? series : [{ sides: {} }]).entries()) {
      const { sides, ...conditions } = entry;
      const sideEntries = Object.keys(sides ?? {}).length
        ? Object.entries(sides ?? {})
        : ([['unavailable', {}]] as [string, SourceSideMeasurement][]);
      const records: SourceReadingRecord[] = sideEntries.map(([side, measured]) => ({
        id: `${run.id}-${index}-${side}`,
        runId: run.id,
        scene: metadata.scene,
        view: entry.view,
        quality: entry.pixelError,
        engine: measured.moteur,
        side,
        canvas: measured.canvas,
        complete: {
          run: series.length ? { ...metadata } : { ...metadata, series: [] },
          frame: { ...conditions },
          measurement: { ...measured },
        },
      }));
      if (records.length) groups.set(`${run.id}-${index}`, records);
    }
  }
  return groups;
}
