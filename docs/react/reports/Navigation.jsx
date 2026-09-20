import { reportCopy } from '../../js/reports/copy.js';
export function ReportNavigation({ locale, onClose }) {
  const c = reportCopy(locale);
  return (
    <ul className="menu menu-md w-full p-0">
      {['overview', 'compare', 'evidence', 'detail', 'references'].map((key) => (
        <li key={key}>
          <button
            type="button"
            onClick={() => {
              onClose();
              requestAnimationFrame(() =>
                document
                  .getElementById(`report-${key}`)
                  ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
              );
            }}
          >
            {c[key]}
          </button>
        </li>
      ))}
    </ul>
  );
}
