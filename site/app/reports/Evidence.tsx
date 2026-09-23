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
  const fr = locale === 'fr';
  const name = (r: ReportRecord) =>
    r.variant === 'raster-calcul'
      ? fr
        ? 'Dessin par calcul'
        : 'Compute drawing'
      : a.engine === b.engine
        ? fr
          ? 'Dessin standard'
          : 'Standard drawing'
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
              {fr ? 'Gauche' : 'Left'} · {left}
            </span>
            <span>
              {fr ? 'Droite' : 'Right'} · {right}
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
          label={fr ? 'Glisser pour comparer les images' : 'Slide to compare images'}
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
        <Collapse
          surface="default"
          title={fr ? 'Chiffres et images originales' : 'Figures and original images'}
        >
          <p>
            {fr ? 'Seuil de détail' : 'Detail threshold'} : {a.quality} px · {a.canvas?.width} ×{' '}
            {a.canvas?.height}
          </p>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {[a, b].map((r) => (
              <div key={r.id}>
                <a className="link" href={src(r)} target="_blank" rel="noreferrer">
                  {name(r)} · {fr ? 'image originale' : 'original image'}
                </a>
                <p>
                  {fr
                    ? 'Répétabilité : pixels différents entre deux captures identiques'
                    : 'Repeatability: different pixels between repeated captures'}{' '}
                  · {formatValue(r.witness?.pixels, locale)} /{' '}
                  {formatValue(r.witness?.total, locale)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-sm text-base-content/75">
            {fr
              ? 'Pixels différents entre les deux images'
              : 'Different pixels between the two images'}{' '}
            : {formatValue(a.difference?.pixels, locale)}.{' '}
            {fr
              ? 'Cette différence visuelle ne mesure pas la vitesse.'
              : 'This visual difference does not measure speed.'}
          </p>
        </Collapse>
      )}
    </div>
  );
}
