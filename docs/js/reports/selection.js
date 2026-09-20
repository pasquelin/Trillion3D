const FIELDS = ['campaign', 'scene', 'view', 'quality', 'left', 'right', 'variable', 'campaignB'];
const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};
export function readSelection(id) {
  return Object.fromEntries(
    FIELDS.map((key, index) => [key, decode((id ?? '').split('~')[index] ?? '')]),
  );
}
export function writeSelection(selection) {
  return FIELDS.map((key) => encodeURIComponent(selection[key] ?? '').replaceAll('~', '%7E')).join(
    '~',
  );
}
export function selectReadings(report, selection) {
  const scene = selection.scene || report.records[0]?.scene;
  const sceneRecords = report.records.filter((record) => record.scene === scene);
  const view =
    selection.view || (sceneRecords.some((r) => r.view === 'sol') ? 'sol' : sceneRecords[0]?.view);
  const quality =
    selection.quality || String(sceneRecords.find((r) => r.view === view)?.quality ?? '');
  return {
    scene,
    view,
    quality,
    records: sceneRecords.filter((r) => r.view === view && String(r.quality) === quality),
  };
}
