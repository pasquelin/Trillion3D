import { ReadingLegend } from './ReadingLegend.jsx';
import { reportCopy } from '../../js/reports/copy.js';
import { sceneName, REPORT_SECTIONS } from '../../js/reports/presentation.js';
import { routeHref } from '../../js/portal/routes.js';
import { useReports } from './useReports.js';
import { Alert } from '../components/UI.jsx';
import { Tabs } from '../components/Tabs.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { Collapse } from '../components/Collapse.jsx';
import { SceneReport } from './SceneReport.jsx';
import { SceneEvidence } from './SceneEvidence.jsx';
import { Experiments } from './Experiments.jsx';
import { Profiles } from './Profiles.jsx';
import { CampaignRuns } from './CampaignRuns.jsx';
import { AllReadings } from './AllReadings.jsx';
import { Findings } from './Findings.jsx';
import { References } from './References.jsx';
export function Report({ route }) {
  const [campaign, active = 'overview'] = route.id.split('/');
  const { report, sources, loading, error } = useReports(campaign);
  const locale = route.locale,
    c = reportCopy(locale),
    fr = locale === 'fr';
  if (loading || error || !report)
    return (
      <Alert tone={error ? 'warning' : 'info'}>
        {c[loading ? 'loading' : error ? 'unavailable' : 'empty']}
      </Alert>
    );
  const scenes = [...new Set(report.records.map((r) => r.scene))];
  const props = { report, locale };
  const content = {
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
      <Tabs
        label={fr ? 'Rubriques du rapport' : 'Report categories'}
        value={active}
        onChange={(tab) => {
          location.hash = routeHref({ ...route, id: `${report.id}/${tab}` });
        }}
        items={REPORT_SECTIONS.map(([id, en, translated]) => ({
          id,
          label: fr ? translated : en,
          render: content[id],
        }))}
      />
    </article>
  );
}
