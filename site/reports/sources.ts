export function readingGroups(sources) {
  const groups = new Map();
  for (const { run, data } of sources) {
    const { series, ...metadata } = data;
    for (const [index, entry] of (series.length ? series : [{ sides: {} }]).entries()) {
      const { sides, ...conditions } = entry;
      const records = (
        Object.keys(sides ?? {}).length ? Object.entries(sides) : [['unavailable', {}]]
      ).map(([side, measured]) => ({
        id: `${run.id}-${index}-${side}`,
        runId: run.id,
        scene: data.scene,
        view: entry.view,
        quality: entry.pixelError,
        engine: measured.moteur,
        side,
        canvas: measured.canvas,
        complete: {
          run: series.length ? metadata : { ...metadata, series: [] },
          frame: conditions,
          measurement: measured,
        },
      }));
      if (records.length) groups.set(`${run.id}-${index}`, records);
    }
  }
  return groups;
}
