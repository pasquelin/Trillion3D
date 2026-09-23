import { useWords } from '../i18n.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { ToggleField } from '../ui/Input.tsx';
import { Segmented } from '../ui/Toolbar.tsx';
import type { Editor } from './useEditor.ts';

const MODES = ['translate', 'rotate', 'scale'] as const;
const SPACES = ['world', 'local'] as const;

/** The handles' tools, in the editor's bar: move, turn or scale (W / E / R), world or local
 *  axes, and snapping. */
export function TransformTools({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const { session } = editor;
  return (
    <>
      <Segmented
        label={t('editor.tools')}
        value={session.gizmo.mode}
        options={MODES.map((mode) => ({ value: mode, label: t(`editor.${mode}`) }))}
        onChange={session.setMode}
      />
      <Segmented
        value={session.gizmo.space}
        options={SPACES.map((space) => ({ value: space, label: t(`editor.space.${space}`) }))}
        onChange={session.setSpace}
      />
      <ToggleField
        label={t('editor.snap')}
        checked={session.snapping}
        onChange={(event) => session.setSnap(event.currentTarget.checked)}
      />
    </>
  );
}
