import type { Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { useWords } from '../i18n.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Note } from '../ui/Text.tsx';
import { Tree } from '../ui/Tree.tsx';
import type { Editor } from './useEditor.ts';

/**
 * The scene's tree, its helper marks left out: a click selects, a drag onto another row puts the
 * object under it, a drag onto the empty part of the panel puts it back at the top of the scene;
 * the object keeps where it stands in the world.
 */
export function Outliner({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const { session, actions } = editor;
  const roots = session.content;
  return (
    <nav
      aria-label={t('editor.outliner')}
      className="flex min-h-0 flex-col gap-2 overflow-y-auto"
    >
      <h2 className="text-xs font-bold uppercase tracking-widest opacity-60">
        {t('editor.outliner')}
      </h2>
      {roots.length === 0 ? (
        <Note>{t('editor.empty')}</Note>
      ) : (
        <Tree<Object3D>
          className="grid flex-1 content-start gap-2"
          nodes={roots}
          keyOf={(node) => node.id}
          labelOf={(node) => node.name || node.type}
          nameOf={(node) => node.name}
          childrenOf={(node) => node.children}
          visibleOf={(node) => node.visible}
          selected={session.selected}
          onSelect={session.select}
          onRename={actions.rename}
          onVisible={actions.setVisible}
          onMove={(node, parent) => actions.reparent(node, parent ?? session.world.scene)}
          labels={{
            rename: t('editor.rename'),
            show: t('editor.show'),
            hide: t('editor.hide'),
          }}
          footer={<Note>{t('editor.dropRoot')}</Note>}
        />
      )}
    </nav>
  );
}
