/** Where the editor keeps the scene between visits, in this browser only; named after its
 *  route, `#/<language>/editor`. */
const KEY = 'web-geometry.editor';

/** Saves the scene `serialize` writes; a browser that refuses storage keeps nothing, silently. */
export function writeAutosave(serialize: () => string) {
  try {
    localStorage.setItem(KEY, serialize());
  } catch {
    // Storage blocked, full, or a scene that cannot be saved: the page works on without it.
  }
}

/** The scene saved last, parsed, or null when there is none or storage is out of reach. */
export function readAutosave(): unknown {
  try {
    const text = localStorage.getItem(KEY);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Forgets the saved scene: one that cannot be read again must not block the next visit. */
export function clearAutosave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget where storage is out of reach.
  }
}
