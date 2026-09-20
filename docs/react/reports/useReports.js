import { useEffect, useState } from 'react';
import { assertReport } from '../../js/reports/contract.js';
export function useReports(campaign, campaignB) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    async function json(path) {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error('Report data unavailable');
      return response.json();
    }
    async function load() {
      const index = await json('reports/index.json');
      if (!Array.isArray(index) || index.some((item) => !/^[a-z0-9-]+$/.test(item.id)))
        throw new Error('Invalid campaign index');
      if (!index.length) return { index, loading: false };
      const id = campaign || index[0].id;
      const otherId = campaignB || id;
      if (![id, otherId].every((key) => index.some((item) => item.id === key)))
        throw new Error('Unknown campaign');
      const report = assertReport(await json(`reports/${id}/report.json`));
      const other =
        otherId === id ? report : assertReport(await json(`reports/${otherId}/report.json`));
      if (report.id !== id || other.id !== otherId) throw new Error('Campaign ID mismatch');
      return { index, report, other, loading: false };
    }
    load()
      .then((value) => {
        if (!controller.signal.aborted) setState(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ error: true, loading: false });
      });
    return () => controller.abort();
  }, [campaign, campaignB]);
  return state;
}
