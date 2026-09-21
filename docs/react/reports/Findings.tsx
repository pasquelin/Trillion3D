import { SceneNotice } from './SceneNotice.tsx';
import { Section } from '../components/Section.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { Stat, StatGroup } from '../components/Stats.tsx';
import { formatValue, metricValue } from '../../js/reports/metrics.js';
import { runOf, sceneName } from '../../js/reports/presentation.js';
import type { Report } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

interface FindingsProps {
  report: Report;
  locale: Locale;
}

export function Findings({ report, locale }: FindingsProps) {
  const fr = locale === 'fr';
  const records = report.records.filter(
    (r) => runOf(report, r) === 'mobile' && r.view === 'sol' && r.quality === 1,
  );
  const missingMachine = report.records.some((r) => !r.provenance?.machine?.id);
  const missingDpr = report.records.some((r) => !r.canvas?.dpr);
  const failed = report.runs.filter((r) => r.status !== 'complete').length;
  return (
    <div className="grid min-w-0 gap-4">
      <p>
        {fr
          ? 'Vue au sol, caméra mobile, seuil de 1 px. Les deux scènes racontent des situations très différentes.'
          : 'Street-level view, moving camera, 1 px threshold. The two scenes show very different situations.'}
      </p>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {records.map((r) => {
          const gpu = metricValue(r, 'gpu'),
            cpu = metricValue(r, 'cpu');
          const over = gpu !== null && gpu > 1000 / 60;
          return (
            <Section key={r.id} title={sceneName(r.scene)}>
              <SceneNotice note={r.sceneNote} locale={locale} />
              <p className="text-lg font-semibold">
                {over
                  ? fr
                    ? 'Le rendu dépasse le budget de temps visé.'
                    : 'Rendering exceeds the target time budget.'
                  : gpu === null
                    ? fr
                      ? 'Le temps GPU n’a pas été mesuré.'
                      : 'GPU time was not measured.'
                    : fr
                      ? 'Le temps GPU reste sous 16,67 ms en médiane.'
                      : 'Median GPU time stays below 16.67 ms.'}
              </p>
              <StatGroup>
                <Stat
                  title={fr ? 'Temps GPU' : 'GPU time'}
                  description={fr ? 'Médiane par image' : 'Median per frame'}
                >
                  {formatValue(gpu, locale, 'ms')}
                </Stat>
                <Stat
                  title={fr ? 'Temps CPU' : 'CPU time'}
                  description={fr ? 'Mesuré séparément' : 'Measured separately'}
                >
                  {formatValue(cpu, locale, 'ms')}
                </Stat>
              </StatGroup>
              <p>
                {over
                  ? fr
                    ? 'Le GPU demande trop de temps pour viser une image toutes les 16,67 ms. Les passes GPU et les étapes CPU sont détaillées dans leur onglet.'
                    : 'The GPU takes too long to target a frame every 16.67 ms. Their passes and stages are detailed in the CPU/GPU tab.'
                  : gpu === null
                    ? fr
                      ? 'Cette mesure ne permet pas de juger la vitesse du GPU.'
                      : 'This reading cannot establish GPU speed.'
                    : fr
                      ? 'Le GPU a de la marge sur ce repère, mais cela ne mesure pas la cadence réellement affichée.'
                      : 'The GPU has headroom against this marker, but this does not measure displayed frame rate.'}
              </p>
              <p>
                {fr ? 'Textures résidentes :' : 'Resident textures:'}{' '}
                <strong>{formatValue(metricValue(r, 'textures'), locale, 'MiB')}</strong>.{' '}
                {fr
                  ? 'Cette allocation n’est pas la mémoire GPU physique totale.'
                  : 'This allocation is not total physical GPU memory.'}
              </p>
            </Section>
          );
        })}
      </div>
      <Section
        title={fr ? 'Ce qui manque pour conclure' : 'What is missing before drawing conclusions'}
      >
        <p>
          <strong>
            {failed} {fr ? 'exécutions sur' : 'runs out of'} {report.runs.length}
          </strong>{' '}
          {failed
            ? fr
              ? 'sont absentes ou incomplètes. Les comparaisons ne couvrent donc pas tous les cas.'
              : 'are missing or incomplete, so comparisons do not cover every case.'
            : fr
              ? 'sont absentes ou incomplètes : toutes les exécutions sont disponibles.'
              : 'are missing or incomplete: all runs are available.'}
        </p>
        {missingMachine && (
          <p>
            {fr
              ? 'L’identité de la machine manque pour certaines mesures.'
              : 'Machine identity is missing for some readings.'}
          </p>
        )}
        {missingDpr && (
          <p>
            {fr ? 'Le DPR manque pour certaines mesures.' : 'DPR is missing for some readings.'}
          </p>
        )}
        <p>
          {fr
            ? 'Les différences visibles décrivent cette campagne, sans garantir une performance reproductible.'
            : 'Visible differences describe this campaign, without guaranteeing reproducible performance.'}
        </p>
        <Collapse surface="nested" title={fr ? 'Comment lire les durées' : 'How to read timings'}>
          <p>
            {fr
              ? '16,67 ms est le temps disponible par image pour viser 60 images/s. CPU et GPU sont mesurés séparément et ne doivent pas être additionnés. p50 est la médiane ; p95 est la durée sous laquelle se trouvent 95 % des échantillons. La variabilité entre exécutions n’a pas été mesurée.'
              : '16.67 ms is the per-frame time budget when targeting 60 fps. CPU and GPU are measured separately and must not be added. p50 is the median; p95 is the duration below which 95% of samples fall. Between-run variability was not measured.'}
          </p>
        </Collapse>
      </Section>
    </div>
  );
}
