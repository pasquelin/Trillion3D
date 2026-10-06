import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Capture } from '../../tests/kit/server/staticServer.ts';
import { resume } from './summary/summary.ts';
import { refuseBlackCaptures } from './imageDiff.ts';
import { recordCuts } from './report/evidence.ts';
import { gazeNetworkLines } from './gazeNetworkRun.ts';
import { fluidsLines } from './fluids.ts';
import { limitsLines } from './limits.ts';
import type { Side } from './sideOptions.ts';
import type { Report } from './report/types.ts';

/** Writes `measure.json` and `resume.md`, and says where. */
export async function publish(
  report: Report,
  sides: Side[],
  captures: Map<string, Capture>,
  out: string,
) {
  report.finishedAt = new Date().toISOString();
  refuseBlackCaptures(report.errors, captures);
  await recordCuts(report, sides, out);
  await writeFile(join(out, 'measure.json'), JSON.stringify(report, null, 1));
  const appendix = [
    ...limitsLines(report.limits),
    ...fluidsLines(report.fluids),
    ...gazeNetworkLines(report.gazeNetwork, report.settings.frames),
  ];
  await writeFile(join(out, 'resume.md'), [resume(report), ...appendix].join('\n'));
  process.stdout.write(
    `\nJSON: ${join(out, 'measure.json')}\nSummary: ${join(out, 'resume.md')}\n`,
  );
  if (report.errors.length) {
    process.stdout.write(`${report.errors.length} page error(s) recorded in the JSON\n`);
    process.exitCode = 1;
  }
}
