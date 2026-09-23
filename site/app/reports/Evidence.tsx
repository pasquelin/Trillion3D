import { useWords } from '../i18n.ts';
import { Collapse } from '../ui/Collapse.tsx';
import { ImageComparison } from '../ui/ImageComparison.tsx';
import { engineName, viewName } from '../../reports/names.ts';
import { formatValue } from '../../reports/metrics.ts';
import type { ReportRecord } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface EvidenceProps {
  a: ReportRecord;
  b: ReportRecord;
  campaign: string;
  locale: Locale;
  imageOnly?: boolean;
}

export function Evidence({ a, b, campaign, locale, imageOnly = false }: EvidenceProps) {
  const t = useWords(locale);
  const name = (r: ReportRecord) =>
    r.variant === 'raster-calcul'
      ? t('evidence.computeDrawing')
      : a.engine === b.engine
        ? t('evidence.standardDrawing')
        : engineName(r.engine);
  const left = name(a),
    right = name(b);
  const src = (r: ReportRecord) => `reports/${campaign}/${r.image}`;
  const sameSize = a.canvas?.width === b.canvas?.width && a.canvas?.height === b.canvas?.height;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4" data-report-image-pair>
      {!imageOnly && (
        <>
          <h3 className="text-lg font-bold">{viewName(a.view, locale)}</h3>
          <div className="flex justify-between gap-4 text-sm font-semibold">
            <span>
              {t('evidence.left')} · {left}
            </span>
            <span>
              {t('evidence.right')} · {right}
            </span>
          </div>
        </>
      )}
      {sameSize ? (
        <ImageComparison
          fitted={imageOnly}
          left={{ label: left, src: src(a) }}
          right={{ label: right, src: src(b) }}
          width={a.canvas?.width}
          height={a.canvas?.height}
          label={t('evidence.slide')}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {[a, b].map((r) => (
            <img
              className={
                imageOnly ? 'max-w-[44vw] max-h-[88dvh] object-contain' : 'w-full rounded-box'
              }
              key={r.id}
              loading="lazy"
              src={src(r)}
              alt={engineName(r.engine)}
            />
          ))}
        </div>
      )}
      {!imageOnly && (
        <Collapse surface="default" title={t('evidence.figures')}>
          <p>
            {t('report.threshold')} : {a.quality} px · {a.canvas?.width} × {a.canvas?.height}
          </p>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {[a, b].map((r) => (
              <div key={r.id}>
                <a className="link" href={src(r)} target="_blank" rel="noreferrer">
                  {name(r)} · {t('evidence.original')}
                </a>
                <p>
                  {t('evidence.repeatability')} · {formatValue(r.witness?.pixels, locale)} /{' '}
                  {formatValue(r.witness?.total, locale)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-sm text-base-content/75">
            {t('evidence.differentPixels')} : {formatValue(a.difference?.pixels, locale)}.{' '}
            {t('evidence.notSpeed')}
          </p>
        </Collapse>
      )}
    </div>
  );
}
