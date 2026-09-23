import { useEffect, useState } from 'react';
import { metricValue } from '../../reports/metrics.ts';
import { runOf } from '../../reports/presentation.ts';
import { loadCampaign } from './loadCampaign.ts';

interface Headline {
  campaign: string;
  scene: string;
  /** The median GPU time of one frame, in milliseconds. */
  gpu: number;
}

/**
 * The latest campaign's first finding, as its report opens on it: the median GPU time of a frame
 * with the camera moving at street level, at the 1 px threshold. None while it loads, and none
 * when no such reading was measured.
 */
export function useHeadline(): Headline | null {
  const [headline, setHeadline] = useState<Headline | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadCampaign(controller.signal)
      .then(({ report }) => {
        const record = report?.records.find(
          (r) =>
            runOf(report, r) === 'mobile' &&
            r.view === 'sol' &&
            r.quality === 1 &&
            metricValue(r, 'gpu') !== null,
        );
        if (report && record?.scene)
          setHeadline({
            campaign: report.id,
            scene: record.scene,
            gpu: metricValue(record, 'gpu')!,
          });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return headline;
}
