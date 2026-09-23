import { useWords } from '../i18n.ts';
import { SceneNotice } from './SceneNotice.tsx';
import { Card } from '../ui/Card.tsx';
import { Collapse } from '../ui/Collapse.tsx';
import { Stat, StatGroup } from '../ui/Stats.tsx';
import { formatValue, metricValue } from '../../reports/metrics.ts';
import { runOf, sceneName } from '../../reports/presentation.ts';
import type { Report } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface FindingsProps {
  report: Report;
  locale: Locale;
}

export function Findings({ report, locale }: FindingsProps) {
  const t = useWords(locale);
  const records = report.records.filter(
    (r) => runOf(report, r) === 'mobile' && r.view === 'sol' && r.quality === 1,
  );
  const missingMachine = report.records.some((r) => !r.provenance?.machine?.id);
  const missingDpr = report.records.some((r) => !r.canvas?.dpr);
  const failed = report.runs.filter((r) => r.status !== 'complete').length;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <p>{t('findings.lead')}</p>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        {records.map((r) => {
          const gpu = metricValue(r, 'gpu'),
            cpu = metricValue(r, 'cpu');
          const over = gpu !== null && gpu > 1000 / 60;
          return (
            <Card key={r.id} title={sceneName(r.scene)}>
              <SceneNotice note={r.sceneNote} locale={locale} />
              <p className="text-lg font-semibold">
                {t(over ? 'findings.over' : gpu === null ? 'findings.noGpu' : 'findings.under')}
              </p>
              <StatGroup>
                <Stat title={t('findings.gpuTime')} description={t('findings.medianPerFrame')}>
                  {formatValue(gpu, locale, 'ms')}
                </Stat>
                <Stat title={t('findings.cpuTime')} description={t('findings.measuredSeparately')}>
                  {formatValue(cpu, locale, 'ms')}
                </Stat>
              </StatGroup>
              <p>
                {t(
                  over
                    ? 'findings.overDetail'
                    : gpu === null
                      ? 'findings.noGpuDetail'
                      : 'findings.underDetail',
                )}
              </p>
              <p>
                {t('findings.textures')}{' '}
                <strong>{formatValue(metricValue(r, 'textures'), locale, 'MiB')}</strong>.{' '}
                {t('findings.texturesNote')}
              </p>
            </Card>
          );
        })}
      </div>
      <Card title={t('findings.missingTitle')}>
        <p>
          <strong>{t('findings.runsOutOf', { failed, total: report.runs.length })}</strong>{' '}
          {t(failed ? 'findings.someFailed' : 'findings.noneFailed')}
        </p>
        {missingMachine && <p>{t('findings.noMachine')}</p>}
        {missingDpr && <p>{t('findings.noDpr')}</p>}
        <p>{t('findings.campaignOnly')}</p>
        <Collapse surface="nested" title={t('findings.readTimings')}>
          <p>{t('findings.timingsNote')}</p>
        </Collapse>
      </Card>
    </div>
  );
}
