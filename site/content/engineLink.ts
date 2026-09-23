const ENGINE_DOCS = 'https://github.com/pasquelin/WebGeometry/blob/develop/docs/ENGINE.md';

/** A "How it works" guide's closing line: the part of docs/ENGINE.md that goes deeper. */
export const engineLink = (anchor: string, label: string) =>
  `<p>${label}: <a href="${ENGINE_DOCS}#${anchor}">docs/ENGINE.md</a>.</p>`;
