import { encodePng } from './cutoutPng.mts';
import { resize, type Thumbnail } from './cutoutThumb.mts';

/**
 * Putting a texture on a terminal, whatever that terminal can do.
 *
 * Three ways down, and every terminal lands on one of them: the kitty protocol, which takes raw
 * texels; the iTerm2 protocol, which takes an image file; and, where neither exists — macOS
 * Terminal, the VS Code panel, a log file — a mosaic of half-blocks, two texels per character in
 * true colour. The picture is coarser there but the shape and the holes still read, and nothing is
 * ever printed as an unreadable blob.
 */
export type ImageKind = 'kitty' | 'iterm' | 'blocks';

/** What this terminal can show. The environment says it; nothing is probed or guessed. */
export function imageKind(env: NodeJS.ProcessEnv = process.env): ImageKind {
  const program = env.TERM_PROGRAM ?? '';
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return 'kitty';
  if (program === 'WarpTerminal' || program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR)
    return 'kitty';
  if (program === 'iTerm.app' || program === 'WezTerm' || program === 'vscode') return 'iterm';
  return 'blocks';
}

/** The kitty graphics protocol: raw RGBA, chunked, placed at the cursor. */
function kitty(thumbnail: Thumbnail): string {
  const payload = Buffer.from(thumbnail.rgba).toString('base64');
  const head = `a=T,f=32,s=${thumbnail.width},v=${thumbnail.height}`;
  let out = '';
  for (let at = 0; at < payload.length; at += 4096) {
    const slice = payload.slice(at, at + 4096);
    const more = at + 4096 < payload.length ? 1 : 0;
    out += `_G${at === 0 ? `${head},m=${more}` : `m=${more}`};${slice}\\`;
  }
  return out;
}

/** The iTerm2 inline-image protocol: a file's bytes, sized in cells so rows stay predictable. */
function iterm(thumbnail: Thumbnail, cells: number): string {
  const png = encodePng(thumbnail.width, thumbnail.height, thumbnail.rgba).toString('base64');
  return `]1337;File=inline=1;width=${cells};height=${cells};preserveAspectRatio=1:${png}`;
}

/** Two texels per character: the upper half painted as foreground, the lower half as background. */
function blocks(thumbnail: Thumbnail, cells: number): string {
  const small = resize(thumbnail, cells, cells * 2);
  const texel = (x: number, y: number) => {
    const at = (y * small.width + x) * 4;
    return [small.rgba[at] ?? 0, small.rgba[at + 1] ?? 0, small.rgba[at + 2] ?? 0] as const;
  };
  const rows: string[] = [];
  for (let y = 0; y < small.height; y += 2) {
    let row = '';
    for (let x = 0; x < small.width; x++) {
      const [tr, tg, tb] = texel(x, y);
      const [br, bg, bb] = texel(x, Math.min(small.height - 1, y + 1));
      row += `[38;2;${tr};${tg};${tb}m[48;2;${br};${bg};${bb}m▀`;
    }
    rows.push(`${row}[0m`);
  }
  return rows.join('\n');
}

/**
 * The texture, drawn as well as this terminal allows, over `cells` character cells. Rendering two
 * pictures side by side is what the caller wants — the colour and its alpha — so the mosaic returns
 * its rows and the image protocols return a single opaque string the caller places on its own line.
 */
export function drawThumbnail(thumbnail: Thumbnail, cells: number, kind: ImageKind): string[] {
  if (kind === 'kitty') return [kitty(resize(thumbnail, cells * 8, cells * 8))];
  if (kind === 'iterm') return [iterm(thumbnail, cells)];
  return blocks(thumbnail, cells).split('\n');
}

/** A clickable link where a terminal supports one, its plain path where it does not. */
export function link(label: string, path: string): string {
  const url = `file://${encodeURI(path)}`;
  return `]8;;${url}\\${label}]8;;\\`;
}
