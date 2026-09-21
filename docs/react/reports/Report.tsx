import type { ReactNode } from 'react';
import { ReadingLegend } from './ReadingLegend.tsx';
import { reportCopy } from '../../js/reports/copy.js';
import { sceneName } from '../../js/reports/presentation.js';
import { useReports } from './useReports.ts';
import { Alert } from '../components/UI.tsx';
import { SectionHeader } from '../components/SectionHeader.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { SceneReport } from './SceneReport.tsx';
import { SceneEvidence } from './SceneEvidence.tsx';
import { Experiments } from './Experiments.tsx';
import { Profiles } from './Profiles.tsx';
import { CampaignRuns } from './CampaignRuns.tsx';
import { AllReadings } from './AllReadings.tsx';
import { Findings } from './Findings.tsx';
import { References } from './References.tsx';
import type { PortalRoute } from '../types/portal.ts';

interface ReportProps {
  route: PortalRoute;
}

export function Report({ route }: ReportProps) {
  const [campaign, active = 'overview'] = route.id.split('/');
  const state = useReports(campaign);
  const locale = route.locale,
    c = reportCopy(locale),
    fr = locale === 'fr';
  if (!state.report)
    return (
      <Alert tone={state.error ? 'warning' : 'info'}>
        {c[state.loading ? 'loading' : state.error ? 'unavailable' : 'empty']}
      </Alert>
    );
  const { report, sources } = state;
  const scenes = [...new Set(report.records.map((r) => r.scene))];
  const props = { report, locale };
  const content: Record<string, () => ReactNode> = {
    overview: () => (
      <>
        <Findings {...props} />
        <Collapse title={fr ? 'Exécutions et sources' : 'Runs and sources'}>
          <CampaignRuns {...props} />
          <a className="link" href={`reports/${report.id}/report.json`} download>
            {c.download}
          </a>
        </Collapse>
      </>
    ),
    compare: () => (
      <>
        <ReadingLegend locale={locale} engines />
        <Collapse title={fr ? 'Comment lire les chiffres ?' : 'How do I read the figures?'}>
          <p>
            {c.p95} {c.timing}
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
    <article className="grid min-w-0 w-full gap-6">
      <SectionHeader
        level={1}
        title={c.title}
        eyebrow={`Web Geometry · ${report.id}`}
        description={`${report.records.length} ${fr ? 'mesures' : 'readings'} · ${report.runs.length} ${fr ? 'exécutions' : 'runs'} · ${scenes.map(sceneName).join(' / ')}`}
      />
      {(Object.hasOwn(content, active) ? content[active] : content.overview)()}
    </article>
  );
}
