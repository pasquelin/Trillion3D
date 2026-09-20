import { reportCopy } from '../../js/reports/copy.js';
import { formatValue } from '../../js/reports/metrics.js';
export function Evidence({ a, b, campaign, campaignB, locale }) {
  const c = reportCopy(locale);
  return (
    <>
      <p>{c.imageNote}</p>
      <div className="report-pair">
        {[a, b].map((record, index) => (
          <figure key={index}>
            <figcaption>
              {index ? 'B' : 'A'} · {record?.engine ?? '—'}
            </figcaption>
            {record?.image ? (
              <a
                href={`reports/${index ? campaignB : campaign}/${record.image}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  loading="lazy"
                  src={`reports/${index ? campaignB : campaign}/${record.image}`}
                  alt={`${index ? 'B' : 'A'} · ${record.scene} · ${record.view}`}
                />
              </a>
            ) : (
              <p className="report-note">{c.noImage}</p>
            )}
            <p className="report-note">
              {c.aa}: {formatValue(record?.witness?.pixels, locale)} /{' '}
              {formatValue(record?.witness?.total, locale)}
            </p>
            <p className="report-note">
              {c.ab}:{' '}
              {formatValue(
                a?.differencePair && a.differencePair === b?.differencePair
                  ? record?.difference?.pixels
                  : null,
                locale,
              )}
            </p>
          </figure>
        ))}
      </div>
    </>
  );
}
