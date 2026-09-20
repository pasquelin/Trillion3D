import { reportCopy } from '../../js/reports/copy.js';
import { formatValue } from '../../js/reports/metrics.js';
const FIELDS = [
  ['frames', 'Measured frames', 'Images mesurées', ''],
  ['warmup', 'Warm-up frames', 'Images de préchauffage', ''],
  ['movingCamera', 'Moving camera', 'Caméra mobile'],
  ['sun', 'Sun', 'Soleil'],
  ['lights', 'Additional lights', 'Lumières supplémentaires', ''],
  ['lightShadows', 'Shadows enabled', 'Ombres activées'],
  ['bounce', 'Indirect lighting', 'Éclairage indirect'],
  ['temporalAntialiasing', 'Temporal antialiasing', 'Anticrénelage temporel'],
  ['stageProfile', 'Profiling enabled', 'Profilage activé'],
  ['visible', 'Visible browser window', 'Fenêtre du navigateur visible'],
  ['shadowBudgetMs', 'Shadow budget', 'Budget des ombres', 'ms'],
  ['geometryPoolBytes', 'Geometry pool budget', 'Budget du pool géométrique', 'MiB'],
  ['texturePoolBytes', 'Texture pool budget', 'Budget du pool de textures', 'MiB'],
];
export function Conditions({ a, b, locale }) {
  const c = reportCopy(locale),
    fr = locale === 'fr';
  const value = (record, key, unit) => {
    const raw = record?.settings?.[key];
    if (typeof raw === 'boolean') return raw ? (fr ? 'Oui' : 'Yes') : fr ? 'Non' : 'No';
    if (typeof raw !== 'number') return c.unknown;
    return formatValue(unit === 'MiB' ? raw / 1048576 : raw, locale, unit);
  };
  return (
    <details>
      <summary>{c.protocol}</summary>
      <div className="report-table">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{c.protocol}</th>
              <th scope="col">A</th>
              <th scope="col">B</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(([key, en, translated, unit]) => (
              <tr key={key}>
                <th scope="row">{fr ? translated : en}</th>
                <td>{value(a, key, unit)}</td>
                <td>{value(b, key, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
