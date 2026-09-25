// Refuses a pull request body that does not start with "Closes #<issue>" or that says
// "Part of #<issue>" (one pull request closes one issue, AGENTS.md rule 5), or whose
// "Local review before push" section lacks its simplification and correctness lines once HTML
// comments are removed. "Lead verification" is required unless PR_DRAFT=true: a draft waits for
// its lead. Usage: [PR_DRAFT=true] node scripts/check-pr-body.ts < body  (the CI feeds it the
// pull request body).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REVIEW_LINES = ['Simplification pass', 'Correctness review'];

/** The lines under `## <title>`, up to the next `## ` heading. */
function section(lines: string[], title: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(`## ${title}`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The first rule the body breaks, or undefined when it passes. */
export function bodyProblem(raw: string, draft: boolean): string | undefined {
  const body = raw.replace(/<!--[\s\S]*?-->/g, '');
  if (/^\s*part of #\d+/im.test(body))
    return 'The body says "Part of #<issue>": one pull request closes one issue; an issue too big for one goes back to the CTO, who splits it (AGENTS.md rule 5).';
  if (!/^Closes #\d+/m.test(body)) return 'The body must start with "Closes #<issue>".';
  const lines = body.split('\n');
  const review = section(lines, 'Local review before push');
  if (!review.join('').trim())
    return 'The section "Local review before push" is empty: run the simplification and correctness passes first.';
  // A thumbnail-only pull request carries no code to review.
  if (body.includes('Thumbnail only')) return undefined;
  if (
    !draft &&
    !section(lines, 'Lead verification').some((l) => /^[-*] .+: (not )?delivered/.test(l))
  )
    return 'The section "Lead verification" is missing or empty: the lead maps every To-do item to its file and test before marking the pull request ready.';
  for (const name of REVIEW_LINES) {
    const line = new RegExp(`^[-* ]*${name}:\\s*\\S`);
    if (!review.some((l) => line.test(l)))
      return `The section "Local review before push" has no "${name}:" line: write what that pass found and fixed.`;
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = bodyProblem(readFileSync(0, 'utf8'), process.env.PR_DRAFT === 'true');
  if (problem) {
    console.error(problem);
    process.exitCode = 1;
  }
}
