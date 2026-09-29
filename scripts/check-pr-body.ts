// Refuses a pull request body that does not start with "Closes #<issue>", or that says "Part of"
// (one pull request closes one issue, AGENTS.md rule 5), or whose "Local review before push"
// section lacks its simplification and correctness lines once HTML comments are removed.
// "Lead verification" is required unless PR_DRAFT=true: a draft waits for its reviewer. Once
// ready, every line of the closed issue's Proof section must be answered there by a
// "- <item>: delivered …, proved by …" line, or carry the boss's yes under "Not proven" (rule 6).
// Usage: [PR_DRAFT=true] [ISSUE_BODY=…] node scripts/check-pr-body.ts < body. The CI feeds it the
// pull request body, and GITHUB_TOKEN + GITHUB_REPOSITORY so that it reads the issue itself; in
// the CI a missing token fails the check rather than skip the Proof lines.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { issuesApi, namedIssues, prose, withoutComments } from './close-named-issues.ts';

const REVIEW_LINES = ['Simplification pass', 'Correctness review'];

/** A tool's own signature never belongs to a body: its footer, its session link (rule 9). */
const GENERATED_FOOTER = /^[^\S\n]*(?:🤖\s*)?generated (?:with|by)\b/im;
const TOOL_SESSION =
  /\b(?:claude\.ai|chatgpt\.com|chat\.openai\.com|copilot\.microsoft\.com|gemini\.google\.com)\b/i;

/** The lines under `## <title>`, up to the next `## ` heading. */
function section(lines: string[], title: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(`## ${title}`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Lower case, no markdown marks, single spaces: how a proof line and its answer are compared. */
const plain = (text: string) =>
  text
    .replace(/^\s*[-*]\s+(\[[ x]\]\s+)?/i, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The issue's Proof lines (a list item or a paragraph, wrapped or not, is one line), without
 *  HTML comments. */
export function proofLines(issue: string): string[] {
  const proofs: string[] = [];
  let open = false;
  for (const line of section(withoutComments(issue).split('\n'), 'Proof')) {
    if (!line.trim()) {
      open = false;
    } else if (open && !/^\s*(?:[-*+]|\d+\.)\s/.test(line)) {
      proofs[proofs.length - 1] += ` ${line}`;
    } else {
      proofs.push(line);
      open = true;
    }
  }
  return proofs.map(plain).filter(Boolean);
}

/**
 * The first Proof line of the issue the body leaves unanswered, or undefined. A line is answered
 * by a Lead verification line "- <item>: delivered …, proved by …" whose item starts with it (whole,
 * or its first 20 characters at least), or by a line under "Not proven" that starts the same way and
 * names the boss's yes.
 */
export function proofProblem(raw: string, issue: string): string | undefined {
  const lines = withoutComments(raw).split('\n');
  const items = (title: string, answer: RegExp) =>
    section(lines, title)
      .map((line) => answer.exec(line)?.[1])
      .filter((item): item is string => item !== undefined)
      .map(plain);
  const answers = [
    ...items('Lead verification', /^[-*] (.+?): delivered\b.*\bproved by\s+\S/),
    ...items('Not proven', /^[-*] (.*\bboss\b.*)$/i),
  ];
  const open = proofLines(issue).find(
    (proof) => !answers.some((answer) => answer.startsWith(proof.slice(0, 20))),
  );
  return open
    ? `The issue's Proof line "${open}" is not answered: write "- <that line>: delivered in <file:line>, proved by <test>" under "Lead verification", or put it under "Not proven" with the boss's yes (AGENTS.md rule 6).`
    : undefined;
}

/**
 * The first rule the body breaks, or undefined when it passes. `issues` are the bodies of the
 * issues it closes, whose Proof lines a ready pull request answers.
 */
export function bodyProblem(
  raw: string,
  draft: boolean,
  issues: string[] = [],
): string | undefined {
  const body = withoutComments(raw);
  if (!/^Closes #\d+/m.test(body)) return 'The body must start with "Closes #<issue>".';
  const text = prose(body);
  // The tool gate holds for every pull request, a draft and a "Thumbnail only" body included.
  if (GENERATED_FOOTER.test(text))
    return 'The body carries a "Generated with …" footer: remove the tool\'s signature, it is not evidence (AGENTS.md rule 9).';
  if (TOOL_SESSION.test(text))
    return 'The body links a tool session (claude.ai, chatgpt.com, …): remove the link, it is not evidence (AGENTS.md rule 9).';
  // The same grammar as close-issues.yml, in any case.
  if (/\bpart of #\d+/i.test(text))
    return 'The body says "Part of": one pull request closes one issue, with "Closes #<issue>" (AGENTS.md rule 5).';
  const lines = body.split('\n');
  const review = section(lines, 'Local review before push');
  if (!review.join('').trim())
    return 'The section "Local review before push" is empty: run the simplification and correctness passes first.';
  // A thumbnail-only pull request carries no code to review.
  if (body.includes('Thumbnail only')) return undefined;
  const verified = section(lines, 'Lead verification');
  if (!draft && !verified.some((l) => /^[-*] .+: (not )?delivered/.test(l)))
    return 'The section "Lead verification" is missing or empty: the reviewer maps every To-do item to its file and test before the pull request is ready.';
  if (verified.some((l) => /^[-*] .+: not delivered/.test(l) && !/boss/i.test(l)))
    return 'An item is "not delivered" without the boss\'s yes: the whole issue is due (AGENTS.md rule 6).';
  for (const name of REVIEW_LINES) {
    const line = new RegExp(`^[-* ]*\`?${name}\`?:\\s*\\S`);
    if (!review.some((l) => line.test(l)))
      return `The section "Local review before push" has no "${name}:" line: write what that pass found and fixed.`;
  }
  if (draft) return undefined;
  for (const issue of issues) {
    const problem = proofProblem(body, issue);
    if (problem) return problem;
  }
  return undefined;
}

/** The bodies of the issues the pull request closes: ISSUE_BODY, else the REST API. */
async function issueBodies(body: string): Promise<string[]> {
  const { ISSUE_BODY, GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, CI } = process.env;
  if (ISSUE_BODY !== undefined) return [ISSUE_BODY];
  if (!token || !repo) {
    if (CI) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required in the CI.');
    console.error('Proof lines not checked: no ISSUE_BODY, GITHUB_TOKEN or GITHUB_REPOSITORY.');
    return [];
  }
  const api = issuesApi(repo, token);
  return Promise.all(namedIssues(body).map(async (issue) => (await api(`${issue}`)).body ?? ''));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const body = readFileSync(0, 'utf8');
  const draft = process.env.PR_DRAFT === 'true';
  // A draft waits for its reviewer, so its issue is not read yet.
  const problem = bodyProblem(body, draft, draft ? [] : await issueBodies(body));
  if (problem) {
    console.error(problem);
    process.exitCode = 1;
  }
}
