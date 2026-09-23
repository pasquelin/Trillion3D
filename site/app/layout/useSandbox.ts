import { useReducer } from 'react';

/** The sandbox's edits: the source in the editor and the source last run, `null` for the
 * starting one in both, so that the state never copies a source it has not changed. */
export interface SandboxState {
  edited: string | null;
  ran: string | null;
}

type SandboxAction = { type: 'edit'; code: string } | { type: 'run' } | { type: 'reset' };

/** Editing changes the editor alone; Run renders what the editor holds; Reset brings both back
 * to the starting source. */
export function sandboxReducer(state: SandboxState, action: SandboxAction): SandboxState {
  if (action.type === 'edit') return { ...state, edited: action.code };
  if (action.type === 'run') return { ...state, ran: state.edited };
  return { edited: null, ran: null };
}

/**
 * The page a sandbox frame loads through `srcdoc`: the source with a `<base>` first in its head,
 * so that its relative imports and assets resolve from `address`, the example it started from,
 * as they do when that file is served itself.
 */
export function sandboxDocument(source: string, address: string) {
  const base = `<base href="${address}">`;
  const head = /<head(\s[^>]*)?>/i;
  return head.test(source) ? source.replace(head, (tag) => tag + base) : base + source;
}

/** Storage can be refused (a private window, blocked site data): the edits then last the visit. */
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, code: string | null) {
  try {
    if (code === null) localStorage.removeItem(key);
    else localStorage.setItem(key, code);
  } catch {
    // Unsaved: the sandbox works the same, for this visit only.
  }
}

/**
 * The sandbox of the example `file`, whose source is `start`: the editor's source, kept across a
 * reload in the browser, and the source the frame shows. The source found on arrival is shown.
 */
export function useSandbox(file: string, start: string) {
  const key = `web-geometry.sandbox/${file}`;
  const [state, dispatch] = useReducer(sandboxReducer, key, (name) => {
    const edited = stored(name);
    return { edited, ran: edited };
  });
  return {
    code: state.edited ?? start,
    shown: state.ran ?? start,
    edit: (code: string) => {
      store(key, code);
      dispatch({ type: 'edit', code });
    },
    run: () => dispatch({ type: 'run' }),
    reset: () => {
      store(key, null);
      dispatch({ type: 'reset' });
    },
  };
}
