import type { ReactNode } from 'react';
import { ReadingLegend } from './ReadingLegend.tsx';
import { sceneName } from '../../reports/presentation.ts';
import { useReports } from './useReports.ts';
import { Alert } from '../ui/Alert.tsx';
import { DocPage } from '../layout/DocPage.tsx';
import { useWords } from '../i18n.ts';
import { TextLink } from '../ui/Text.tsx';
import { Collapse } from '../ui/Collapse.tsx';
import { SceneReport } from './SceneReport.tsx';
import { SceneEvidence } from './SceneEvidence.tsx';
import { Experiments } from './Experiments.tsx';
import { Profiles } from './Profiles.tsx';
import { CampaignRuns } from './CampaignRuns.tsx';
import { AllReadings } from './AllReadings.tsx';
import { Findings } from './Findings.tsx';
import { References } from './References.tsx';
import type { PortalRoute } from '../portal/routes.ts';

interface ReportProps {
  route: PortalRoute;
}

export function Report({ route }: ReportProps) {
  const [campaign, active = 'overview'] = route.id.split('/');
  const state = useReports(campaign);
  const locale = route.locale;
  const t = useWords(locale);
  if (!state.report)
    return (
      <DocPage title={t('report.title')}>
        <Alert tone={state.error ? 'warning' : 'info'}>
          {t(
            state.loading ? 'report.loading' : state.error ? 'report.unavailable' : 'report.empty',
          )}
        </Alert>
      </DocPage>
    );
  const { report, sources } = state;
  const scenes = [...new Set(report.records.map((r) => r.scene))];
  const props = { report, locale };
  const content: Record<string, () => ReactNode> = {
    overview: () => (
      <>
        <Findings {...props} />
        <Collapse title={t('report.runsAndSources')}>
          <CampaignRuns {...props} />
          <TextLink href={`reports/${report.id}/report.json`} download>
            {t('report.download')}
          </TextLink>
        </Collapse>
      </>
    ),
    compare: () => (
      <>
        <ReadingLegend locale={locale} engines />
        <Collapse title={t('report.readFigures')}>
          <p>
            {t('report.p95')} {t('report.timing')}
          </p>
        </Collapse>
        {scenes.map((scene) => (
          <SceneReport key={scene} {...props} scene={scene} />
        ))}
      </>
    ),
    evidence: () => scenes.map((scene) => <SceneEvidence key={scene} {...props} scene={scene} />),
    experiments: () => (
      <>
        <ReadingLegend locale={locale} />
        {scenes.map((scene) => (
          <Experiments key={scene} {...props} scene={scene} />
        ))}
      </>
    ),
    detail: () => <Profiles {...props} />,
    'all-values': () => <AllReadings {...props} sources={sources} />,
    references: () => <References locale={locale} />,
  };
  return (
    <DocPage
      title={t('report.title')}
      eyebrow={`${t('reports.campaign')} ${report.id}`}
      lead={`${t('report.counts', { readings: report.records.length, runs: report.runs.length })} · ${scenes.map(sceneName).join(' / ')}`}
    >
      {(Object.hasOwn(content, active) ? content[active] : content.overview)()}
    </DocPage>
  );
}
