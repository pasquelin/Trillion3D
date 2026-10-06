/**
 * The documentation of the message catalogue (`packages/sdk-node/src/messages/messages.json`):
 * `docs/COMPILER_ERRORS.md`, one table per group and one row per code, the row each message links
 * to (`#t3d-e001`). Generated, never edited: `pnpm run generate:messages` writes it, `--check`
 * fails when it lags the catalogue.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  catalogueMessages,
  type CatalogueMessage,
} from '../packages/sdk-node/src/messages/catalogue.mts'

const MESSAGES_INDEX = 'docs/COMPILER_ERRORS.md'
const LEVEL = { error: 'error', warn: 'warning', info: 'info' } as const
const GENERATED =
  '<!-- Generated from packages/sdk-node/src/messages/messages.json by scripts/message-pages.ts: edit the catalogue, then run `pnpm run generate:messages`. -->'
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

function index(messages: readonly CatalogueMessage[]) {
  const groups = [...new Set(messages.map((entry) => entry.group))]
  const lines = [
    '# Compiler message codes',
    '',
    GENERATED,
    '',
    'Every message of the compiler, of its Node adapter and of the browser runtime has a stable',
    'public code, one sentence, its cause and the action to take.',
    '`T3D-Exxx` is an error: the job, or in the browser what needed it, goes no further.',
    '`T3D-Wxxx` is a warning: always told, it never stops a compile that can succeed',
    '(`trillion3d-compile --strict` fails on it). `T3D-Ixxx` is an info, told on request',
    '(`--verbose`). The events and the cache keep writing the symbolic name as `code`; the',
    'catalogue maps it to its public code. Exit codes and message prefixes:',
    '[COMPILER.md](COMPILER.md#exit-codes-and-error-codes).',
  ]
  for (const group of groups) {
    lines.push(
      '',
      `## ${group}`,
      '',
      '| Code | Name | Level | Message | Cause | What to do |',
      '| --- | --- | --- | --- | --- | --- |',
    )
    for (const entry of messages.filter((m) => m.group === group))
      lines.push(
        `| <a id="${entry.id.toLowerCase()}"></a>${entry.id} | \`${entry.code}\` | ${LEVEL[entry.level]} | ${[entry.message, entry.cause, entry.action].map(cell).join(' | ')} |`,
      )
  }
  return `${lines.join('\n')}\n`
}

/** Whether `docs/COMPILER_ERRORS.md` under `root` differs from what the catalogue writes. */
export function staleIndex(root: string) {
  try {
    return readFileSync(join(root, MESSAGES_INDEX), 'utf8') !== index(catalogueMessages)
  } catch {
    return true
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd()
  if (!process.argv.includes('--check'))
    writeFileSync(join(root, MESSAGES_INDEX), index(catalogueMessages))
  else if (staleIndex(root))
    throw new Error(`${MESSAGES_INDEX} is out of date: run generate:messages`)
}
