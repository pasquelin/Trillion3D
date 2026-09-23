import { t } from '../../content/i18n/index.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Button } from '../ui/Button.tsx';
import { Toggle } from '../ui/Input.tsx';
import type { Editor } from './useEditor.ts';

const MODES = ['translate', 'rotate', 'scale'] as const;
const SPACES = ['world', 'local'] as const;

/** The handles' tools: move, turn or scale (W / E / R), world or local axes, and snapping. */
export function Toolbar({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const { session } = editor;
  const choice = (active: boolean) => ({
    size: 'sm' as const,
    variant: active ? ('primary' as const) : ('ghost' as const),
    className: 'join-item',
    'aria-pressed': active,
  });
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="toolbar"
      aria-label={t(locale, 'editor.tools')}
    >
      <div className="join">
        {MODES.map((mode) => (
          <Button
            key={mode}
            {...choice(session.gizmo.mode === mode)}
            onClick={() => session.setMode(mode)}
          >
            {t(locale, `editor.${mode}`)}
          </Button>
        ))}
      </div>
      <div className="join">
        {SPACES.map((space) => (
          <Button
            key={space}
            {...choice(session.gizmo.space === space)}
            onClick={() => session.setSpace(space)}
          >
            {t(locale, `editor.space.${space}`)}
          </Button>
        ))}
      </div>
      <label className="label cursor-pointer gap-2 text-sm">
        <Toggle
          checked={session.snapping}
          onChange={(event) => session.setSnap(event.currentTarget.checked)}
        />
        {t(locale, 'editor.snap')}
      </label>
    </div>
  );
}
