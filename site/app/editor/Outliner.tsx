import type { Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { useWords } from '../i18n.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Note } from '../ui/Text.tsx';
import { Tree } from '../ui/Tree.tsx';
import type { Editor } from './useEditor.ts';

/**
 * The scene's tree, in the editor's Scene panel, its helper marks left out: a click selects, a
 * drag onto another row puts the object under it, a drag onto the empty part of the panel puts it
 * back at the top of the scene; the object keeps where it stands in the world.
 */
export function Outliner({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const { session, actions } = editor;
  const roots = session.content;
  if (roots.length === 0) return <Note>{t('editor.empty')}</Note>;
  return (
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
  );
}
