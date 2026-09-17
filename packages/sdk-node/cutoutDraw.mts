import { encodePng } from './cutoutPng.mts';
import { resize, type Thumbnail } from './cutoutThumb.mts';

/**
 * Putting a texture on a terminal, whatever that terminal can do.
 *
 * Three ways down, and every terminal lands on one of them: the kitty protocol, the iTerm2
 * protocol, and — where neither exists, as in macOS Terminal or a log — a mosaic of half-blocks,
 * two texels per character in true colour.
 *
 * Two rules the first version got wrong and that matter more than the protocol. The picture is
 * always placed in a box counted in CHARACTER CELLS, never in pixels: a terminal stretches an
 * unplaced image to whatever grid it likes, and a leaf shown twice as tall as it is teaches
 * nothing. And the sharpest source wins: the texture's own file when it is one on disk, the cache's
 * 64-pixel thumbnail only when the image is embedded in the scene and has no file of its own.
 */
export type ImageKind = 'kitty' | 'iterm' | 'blocks';

/** The box a picture is drawn in. A cell is about twice as tall as it is wide, so these are square. */
const COLUMNS = 24;
const ROWS = 12;

/** What this terminal can show. The environment says it; nothing is probed or guessed. */
export function imageKind(env: NodeJS.ProcessEnv = process.env): ImageKind {
  const program = env.TERM_PROGRAM ?? '';
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return 'kitty';
  if (program === 'WarpTerminal' || program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR)
    return 'kitty';
  if (program === 'iTerm.app' || program === 'WezTerm' || program === 'vscode') return 'iterm';
  return 'blocks';
}

/** The kitty graphics protocol, chunked: raw texels (`f=32`) or an image file's bytes (`f=100`). */
function kitty(payload: Buffer, head: string): string {
  const text = payload.toString('base64');
  let out = '';
  for (let at = 0; at < text.length; at += 4096) {
    const slice = text.slice(at, at + 4096);
    const more = at + 4096 < text.length ? 1 : 0;
    out += `_G${at === 0 ? `${head},m=${more}` : `m=${more}`};${slice}\\`;
  }
  return out;
}

/** The iTerm2 inline-image protocol, sized in cells so rows stay predictable. */
function iterm(png: Buffer): string {
  return `]1337;File=inline=1;width=${COLUMNS};height=${ROWS};preserveAspectRatio=1:${png.toString('base64')}`;
}

/** Two texels per character, the aspect kept: upper half as foreground, lower half as background. */
function blocks(thumbnail: Thumbnail): string[] {
  const rows = Math.max(
    2,
    Math.min(ROWS * 2, Math.round((COLUMNS * thumbnail.height) / thumbnail.width / 2) * 2),
  );
  const small = resize(thumbnail, COLUMNS, rows);
  const texel = (x: number, y: number) => {
    const at = (y * small.width + x) * 4;
    return [small.rgba[at] ?? 0, small.rgba[at + 1] ?? 0, small.rgba[at + 2] ?? 0] as const;
  };
  const lines: string[] = [];
  for (let y = 0; y < small.height; y += 2) {
    let line = '';
    for (let x = 0; x < small.width; x++) {
      const [tr, tg, tb] = texel(x, y);
      const [br, bg, bb] = texel(x, Math.min(small.height - 1, y + 1));
      line += `[38;2;${tr};${tg};${tb}m[48;2;${br};${bg};${bb}m▀`;
    }
    lines.push(`${line}[0m`);
  }
  return lines;
}

/** The cache's thumbnail, drawn in the box. Its own texels: there is nothing sharper to send. */
export function drawThumbnail(thumbnail: Thumbnail, kind: ImageKind): string[] {
  if (kind === 'kitty')
    return [
      kitty(
        Buffer.from(thumbnail.rgba),
        `a=T,f=32,s=${thumbnail.width},v=${thumbnail.height},c=${COLUMNS},r=${ROWS}`,
      ),
    ];
  if (kind === 'iterm')
    return [iterm(encodePng(thumbnail.width, thumbnail.height, thumbnail.rgba))];
  return blocks(thumbnail);
}

/**
 * An image FILE drawn in the same box, at whatever resolution it holds — the texture as the artist
 * saved it, not a 64-pixel echo of it. The terminals that take a file take it as it is, so nothing
 * is decoded here; a terminal without a protocol has no use for it and says so.
 */
export function drawFile(bytes: Buffer, kind: ImageKind): string[] | null {
  if (kind === 'kitty') return [kitty(bytes, `a=T,f=100,c=${COLUMNS},r=${ROWS}`)];
  if (kind === 'iterm') return [iterm(bytes)];
  return null;
}

/** A clickable link where a terminal supports one, its plain path where it does not. */
export function link(label: string, path: string): string {
  const url = `file://${encodeURI(path)}`;
  return `]8;;${url}\\${label}]8;;\\`;
}
