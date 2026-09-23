import { assertReport } from '../../reports/contract.ts';
import type { CampaignIndexItem, Report } from '../../reports/types.ts';

/** Reads one JSON file of the published reports, refusing a missing one. */
export async function readJson(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('Report data unavailable');
  return response.json();
}

/** The campaign index and the report of `campaign`, the latest when none is named; no report
 * when nothing is published. */
export async function loadCampaign(
  signal: AbortSignal,
  campaign?: string,
): Promise<{ index: CampaignIndexItem[]; report?: Report }> {
  const index: CampaignIndexItem[] = await readJson('reports/index.json', signal);
  if (!Array.isArray(index) || index.some((item) => !/^[a-z0-9-]+$/.test(item.id)))
    throw new Error('Invalid campaign index');
  if (!index.length) return { index };
  const id = campaign || index[0].id;
  if (!index.some((item) => item.id === id)) throw new Error('Unknown campaign');
  const report: Report = assertReport(await readJson(`reports/${id}/report.json`, signal));
  if (report.id !== id) throw new Error('Campaign ID mismatch');
  return { index, report };
}
