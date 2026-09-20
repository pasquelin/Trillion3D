#!/usr/bin/env node
// Export campaign data independently of the portal build and benchmark execution.
import { resolve, join } from 'node:path';
import { parseArgs } from './options.mjs';
import { exportReport } from './report/export.mjs';
const flags = parseArgs(process.argv.slice(2));
const source = resolve(flags.get('dossier') ?? '.mesure/out/global');
const output = resolve(flags.get('vers') ?? join(source, 'report-data'));
const id = flags.get('id') ?? 'current';
const report = exportReport(source, output, id);
console.log(`Report data: ${output} (${report.records.length} readings)`);
