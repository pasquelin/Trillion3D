import { fingerprintBuild } from '../../write-build-provenance.mjs';
import { analyseFile, neighboringCut } from '../coupeAnalyse.mjs';
import { sceneDerived } from '../scene.mjs';
import { assetIdentity } from './provenance.mjs';
/** Freeze asset/build identity and cut analysis while the measured inputs are still present. */
export async function recordInputs(report, sides) {
  for (const side of sides) {
    report.sides[side.name].assetKey = assetIdentity(side.cache ?? sceneDerived(report.scene));
    report.sides[side.name].buildHash = (await fingerprintBuild(side.dist)).hash;
  }
}
export function recordCuts(report, sides, out) {
  for (const series of report.series) {
    for (const side of sides) {
      const reading = series.sides?.[side.name];
      if (!reading) continue;
      try {
        reading.cutAnalysis = analyseFile(
          neighboringCut(out, reading.png),
          side.cache ?? sceneDerived(report.scene),
        );
      } catch (error) {
        reading.cutAnalysis = null;
        report.errors.push({ kind: 'cut-analysis', message: String(error.message) });
      }
    }
  }
}
