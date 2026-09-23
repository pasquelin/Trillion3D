import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { wordsOf } from '../i18n.ts';
import type { Locale } from '../../content/locale.ts';
import { sceneActions, type SceneActions } from './actions.ts';
import { bindInput } from './input.ts';
import { createSession, type Session } from './session.ts';

/** The editor a page holds: its session on the world, the actions of its menus, and where a
 *  failure is told to the person. */
export interface Editor {
  session: Session;
  actions: SceneActions;
  failed: (error: unknown) => void;
}

/** What the person reads of a failure: a refused format by name, anything else by its message. */
function failureText(locale: Locale, error: unknown) {
  const t = wordsOf(locale);
  if ((error as { code?: string } | null)?.code === 'UNSUPPORTED_SCENE_FORMAT')
    return t('editor.error.format');
  return `${t('editor.error.read')} ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Opens the editor on `canvas` once the engine is loaded (only this page pays for it), restores
 * the scene this browser saved last, and gives it all back on unmount. The page draws again after
 * each edit, selection or tool change: the panels read the scene again. `fail` shows a message
 * and must keep its identity (a state setter does).
 */
export function useEditor(
  canvas: RefObject<HTMLCanvasElement | null>,
  locale: Locale,
  fail: (message: string) => void,
) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, setVersion] = useState(0);
  // Read at each use: a change of language renames what comes next, never reopens the world.
  const language = useRef(locale);
  language.current = locale;
  useEffect(() => {
    let release: (() => void) | null = null,
      gone = false;
    const failed = (error: unknown) => {
      if (!gone) fail(failureText(language.current, error));
    };
    void import('../../../packages/sdk-browser/src/index.ts')
      .then(async (engine) => {
        const target = canvas.current;
        if (gone || !target) return;
        const session = createSession(engine, target, () => setVersion((count) => count + 1));
        const actions = sceneActions(
          session,
          (kind) => wordsOf(language.current)(`editor.add.${kind}`),
          failed,
        );
        const unbind = bindInput(session, actions, target);
        release = () => {
          unbind();
          session.dispose();
        };
        // The panels open once the saved scene is back: an edit made while it loads would be
        // saved over it, then swept away with the history when it arrives.
        await actions.restore();
        if (!gone) setEditor({ session, actions, failed });
      })
      .catch(failed);
    return () => {
      gone = true;
      release?.();
      setEditor(null);
    };
  }, [canvas, fail]);
  return editor;
}
