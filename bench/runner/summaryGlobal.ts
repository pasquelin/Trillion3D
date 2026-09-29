#!/usr/bin/env node
// Export campaign data independently of the portal build and benchmark execution.
import { resolve, join } from 'node:path';
import { parseArgs } from './options.ts';
import { exportReport } from './report/export.ts';
import { measureOutput } from '../core/paths.ts';
const flags = parseArgs(process.argv.slice(2));
const source = resolve(flags.get('from') ?? measureOutput('global'));
const output = resolve(flags.get('to') ?? join(source, 'report-data'));
const id = flags.get('id') ?? 'current';
flags.refuseUnread();
const report = exportReport(source, output, id);
console.log(`Report data: ${output} (${report.records.length} readings)`);
