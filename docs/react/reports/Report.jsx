import { Conditions } from './Conditions.jsx';
import { CampaignRuns } from './CampaignRuns.jsx';
import { reportCopy } from '../../js/reports/copy.js';
import { readSelection, selectReadings, writeSelection } from '../../js/reports/selection.js';
import { routeHref } from '../../js/portal/routes.js';
import { useReports } from './useReports.js';
import { Alert, Field, Select } from '../components/UI.jsx';
import { Section } from '../components/Section.jsx';
import { Overview } from './Overview.jsx';
import { Diagnostics } from './Diagnostics.jsx';
import { Filters, ReadingPicker } from './Filters.jsx';
import { Comparison } from './Comparison.jsx';
import { Evidence } from './Evidence.jsx';
import { Details } from './Details.jsx';
export function Report({ route }) {
  const selection = readSelection(route.id);
  const state = useReports(selection.campaign, selection.campaignB);
  const c = reportCopy(route.locale);
  if (state.loading || state.error || !state.report)
    return (
      <Alert tone={state.error ? 'warning' : 'info'}>
        {c[state.loading ? 'loading' : state.error ? 'unavailable' : 'empty']}
      </Alert>
    );
  return <ReportContent {...state} route={route} selection={selection} />;
}
function ReportContent({ report, other, index, route, selection }) {
  const locale = route.locale,
    c = reportCopy(locale);
  const selected = selectReadings(report, selection);
  const otherRecords = selectReadings(other, { ...selection, ...selected }).records;
  const a =
    selected.records.find((r) => r.id === selection.left) ??
    selected.records.find(
      (r) =>
        report.runs.find((run) => run.id === r.runId)?.name === 'three-nu' &&
        r.engine.includes('three'),
    ) ??
    selected.records[0];
  const b =
    otherRecords.find((r) => r.id === selection.right) ??
    otherRecords.find((r) => r.runId === a?.runId && r.id !== a?.id) ??
    otherRecords.find((r) => r.id !== a?.id) ??
    otherRecords[0];
  const variable = selection.variable || 'engine';
  function change(key, value) {
    const next = {
      ...selection,
      ...selected,
      campaign: report.id,
      campaignB: other.id,
      left: a?.id,
      right: b?.id,
      variable,
      [key]: value,
    };
    if (['campaign', 'scene', 'view', 'quality', 'campaignB'].includes(key)) {
      next.left = '';
      next.right = '';
      if (key === 'campaign') {
        next.scene = '';
        next.view = '';
        next.quality = '';
      }
      if (key === 'scene') {
        next.view = '';
        next.quality = '';
      }
      if (key === 'view') next.quality = '';
    }
    location.hash = routeHref({ ...route, id: writeSelection(next) });
  }
  return (
    <article className="report-page">
      <header className="report-intro" id="report-overview">
        <p className="eyebrow">Web Geometry · {c.overview}</p>
        <h1>{c.title}</h1>
        <p>{c.intro}</p>
        <a className="link" href={`reports/${report.id}/report.json`} download>
          {c.download}
        </a>
      </header>
      <Filters {...{ report, index, selection, selected, locale }} onChange={change} />
      <Overview {...{ a, b, report, locale }} />
      {report.records.some((r) => !r.provenance) && (
        <Alert>
          {c.historical}. {c.missing}
        </Alert>
      )}
      <Section title={c.compare} id="report-compare">
        <div className="report-pair">
          <ReadingPicker
            locale={locale}
            label={c.left}
            records={selected.records}
            runs={report.runs}
            value={a?.id}
            onChange={(v) => change('left', v)}
          />
          <ReadingPicker
            locale={locale}
            label={c.right}
            records={otherRecords}
            runs={other.runs}
            value={b?.id}
            onChange={(v) => change('right', v)}
          />
        </div>
        <Field label={c.variable}>
          <Select value={variable} onChange={(e) => change('variable', e.target.value)}>
            {['engine', 'version', 'lightShadows', 'temporalAntialiasing', 'mathPath'].map(
              (key) => (
                <option key={key} value={key}>
                  {c[key]}
                </option>
              ),
            )}
          </Select>
        </Field>
        <Comparison {...{ a, b, variable, locale }} />
      </Section>
      {(a?.sceneNote || b?.sceneNote) && <Alert tone="warning">{c.sourceTextures}</Alert>}
      <Section title={c.evidence} id="report-evidence">
        <Evidence {...{ a, b, locale }} campaign={report.id} campaignB={other.id} />
      </Section>
      <Section title={c.detail} id="report-detail">
        <Alert>{c.timing}</Alert>
        <Conditions {...{ a, b, locale }} />
        <Diagnostics {...{ a, b, locale }} />
        <div className="report-pair">
          <Details record={a} report={report} locale={locale} label="A" />
          <Details record={b} report={other} locale={locale} label="B" />
        </div>
      </Section>
      <CampaignRuns {...{ report, locale }} />
      <Section title={c.references} id="report-references">
        <p>{c.referenceNote}</p>
        <a className="link" href="REFERENCE_UE5.md">
          {c.referenceLink}
        </a>
      </Section>
    </article>
  );
}
