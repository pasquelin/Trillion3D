/** A line that opens a section: `// --- <name>`, the header both programs of a comparison share. */
const HEADER = /^\s*\/\/ --- /;

/** The index of the last line of each segment of `code`: the preamble, then each section. */
function segmentEnds(code: string) {
  const lines = code.split('\n');
  const ends = lines.flatMap((line, index) => (index > 0 && HEADER.test(line) ? [index - 1] : []));
  return [...ends, lines.length - 1];
}

/**
 * The blank rows to show after some lines of two programs cut by the same section headers, so
 * that each header sits on the same row in both: a shorter segment is padded after its last line.
 * The programs themselves are untouched — a copy stays the file as written.
 */
export function sectionGaps(left: string, right: string) {
  const [leftEnds, rightEnds] = [segmentEnds(left), segmentEnds(right)];
  const gaps = [new Map<number, number>(), new Map<number, number>()] as const;
  if (leftEnds.length !== rightEnds.length) return gaps;
  // How many blank rows the left side has received beyond the right one so far.
  let shift = 0;
  leftEnds.forEach((leftEnd, at) => {
    const difference = rightEnds[at] - leftEnd - shift;
    if (difference > 0) gaps[0].set(leftEnd, difference);
    if (difference < 0) gaps[1].set(rightEnds[at], -difference);
    shift += difference;
  });
  return gaps;
}
