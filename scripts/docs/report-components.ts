import { loadReactComponents } from './render-react.ts';
import type { Comparison as ComparisonComponent } from '../../site/app/reports/Comparison.tsx';
import type { Evidence as EvidenceComponent } from '../../site/app/reports/Evidence.tsx';
import type { AllReadings as AllReadingsComponent } from '../../site/app/reports/AllReadings.tsx';
import type { BarChart as BarChartComponent } from '../../site/app/components/BarChart.tsx';
import type { Findings as FindingsComponent } from '../../site/app/reports/Findings.tsx';
import type { SceneNotice as SceneNoticeComponent } from '../../site/app/reports/SceneNotice.tsx';

/** The report test's six React components, typed against their real prop signatures instead
 * of the `unknown` `loadReactComponents` returns for its esbuild-compiled module. */
export const { Comparison } = (await loadReactComponents('site/app/reports/Comparison.tsx')) as {
  Comparison: typeof ComparisonComponent;
};
export const { Evidence } = (await loadReactComponents('site/app/reports/Evidence.tsx')) as {
  Evidence: typeof EvidenceComponent;
};
export const { AllReadings } = (await loadReactComponents('site/app/reports/AllReadings.tsx')) as {
  AllReadings: typeof AllReadingsComponent;
};
export const { BarChart } = (await loadReactComponents('site/app/components/BarChart.tsx')) as {
  BarChart: typeof BarChartComponent;
};
export const { Findings } = (await loadReactComponents('site/app/reports/Findings.tsx')) as {
  Findings: typeof FindingsComponent;
};
export const { SceneNotice } = (await loadReactComponents('site/app/reports/SceneNotice.tsx')) as {
  SceneNotice: typeof SceneNoticeComponent;
};
