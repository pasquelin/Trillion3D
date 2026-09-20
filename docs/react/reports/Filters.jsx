import { viewName, runName, engineName } from '../../js/reports/names.js';
import { Field, Select } from '../components/UI.jsx';
import { reportCopy } from '../../js/reports/copy.js';
const unique = (values) => [...new Set(values)];
export function Filters({ report, index, selection, selected, onChange, locale }) {
  const c = reportCopy(locale);
  const fields = [
    ['campaign', index.map((item) => item.id), report.id],
    ['campaignB', index.map((item) => item.id), selection.campaignB || report.id],
    ['scene', unique(report.records.map((r) => r.scene)), selected.scene],
    [
      'view',
      unique(report.records.filter((r) => r.scene === selected.scene).map((r) => r.view)),
      selected.view,
    ],
    [
      'quality',
      unique(
        report.records
          .filter((r) => r.scene === selected.scene && r.view === selected.view)
          .map((r) => String(r.quality)),
      ),
      selected.quality,
    ],
  ];
  return (
    <div className="report-filters">
      {fields.map(([key, values, value]) => (
        <Field key={key} label={c[key]}>
          <Select value={value} onChange={(e) => onChange(key, e.target.value)}>
            {values.map((item) => (
              <option key={item} value={item}>
                {key === 'view' ? viewName(item, locale) : item}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </div>
  );
}
export function ReadingPicker({ label, records, value, runs, onChange, locale }) {
  return (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {!records.length && <option value="">—</option>}
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {engineName(r.engine)} · {runName(runs.find((run) => run.id === r.runId)?.name, locale)}{' '}
            · {r.commit?.slice(0, 8) ?? '—'}
          </option>
        ))}
      </Select>
    </Field>
  );
}
