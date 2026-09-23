import { REPOSITORY } from './model.ts';

/** A "How it works" guide's closing line: the part of docs/ENGINE.md that goes deeper. */
export const engineLink = (anchor: string, label: string) =>
  `<p>${label}: <a href="${REPOSITORY}/blob/develop/docs/ENGINE.md#${anchor}">docs/ENGINE.md</a>.</p>`;
