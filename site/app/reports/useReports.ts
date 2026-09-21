import { useEffect, useState } from 'react';
import { assertReport } from '../../reports/contract.ts';
import type { CampaignIndexItem, Report, ReportsState, ReportSource } from '../types/reports.ts';

export function useReports(campaign?: string): ReportsState {
  const [state, setState] = useState<ReportsState>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    async function json(path: string) {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error('Report data unavailable');
      return response.json();
    }
    async function load(): Promise<ReportsState> {
      const index: CampaignIndexItem[] = await json('reports/index.json');
      if (!Array.isArray(index) || index.some((item) => !/^[a-z0-9-]+$/.test(item.id)))
        throw new Error('Invalid campaign index');
      if (!index.length) return { index, loading: false };
      const id = campaign || index[0].id;
      if (!index.some((item) => item.id === id)) throw new Error('Unknown campaign');
      const report: Report = assertReport(await json(`reports/${id}/report.json`));
      if (report.id !== id) throw new Error('Campaign ID mismatch');
      const sources: ReportSource[] = [];
      // Bound file requests so opening the full report does not flood the browser.
      const runs = report.runs.filter((run) => run.source);
      for (let start = 0; start < runs.length; start += 4) {
        const batch = await Promise.all(
          runs.slice(start, start + 4).map(async (run) => ({
            run,
            data: await json(`reports/${id}/${run.source}`),
          })),
        );
        sources.push(...batch);
      }
      return { index, report, sources, loading: false };
    }
    load()
      .then((value) => {
        if (!controller.signal.aborted) setState(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ error: true, loading: false });
      });
    return () => controller.abort();
  }, [campaign]);
  return state;
}
