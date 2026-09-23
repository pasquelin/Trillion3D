import { useEffect, useState } from 'react';
import type { ReportsState, ReportSource } from '../../reports/types.ts';
import { loadCampaign, readJson } from './loadCampaign.ts';

export function useReports(campaign?: string): ReportsState {
  const [state, setState] = useState<ReportsState>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<ReportsState> {
      const { index, report } = await loadCampaign(controller.signal, campaign);
      if (!report) return { index, loading: false };
      const sources: ReportSource[] = [];
      // Bound file requests so opening the full report does not flood the browser.
      const runs = report.runs.filter((run) => run.source);
      for (let start = 0; start < runs.length; start += 4) {
        const batch = await Promise.all(
          runs.slice(start, start + 4).map(async (run) => ({
            run,
            data: await readJson(`reports/${report.id}/${run.source}`, controller.signal),
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
