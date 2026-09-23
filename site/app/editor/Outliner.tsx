import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { useWords } from '../i18n.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Button } from '../ui/Button.tsx';
import { Note } from '../ui/Text.tsx';
import type { Editor } from './useEditor.ts';

interface RowProps {
  editor: Editor;
  node: Object3D;
  /** The row being dragged, shared by every row of the tree. */
  dragged: { current: Object3D | null };
}

/** Drops the dragged row under `parent`: the object keeps where it stands in the world. */
function dropOn(event: DragEvent, editor: Editor, dragged: RowProps['dragged'], parent: Object3D) {
  event.preventDefault();
  event.stopPropagation();
  if (dragged.current) editor.actions.reparent(dragged.current, parent);
  dragged.current = null;
}

/** One object of the tree: its name (a click selects, a double click renames), its eye, and the
 * rows of its children below it. */
function Row({ editor, node, dragged }: RowProps) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const [renaming, setRenaming] = useState(false);
  const { session, actions } = editor;
  const current = session.selected === node;
  const label = node.name || node.type;
  return (
    <li>
      <div
        draggable={!renaming}
        onDragStart={(event) => {
          dragged.current = node;
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => (dragged.current = null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropOn(event, editor, dragged, node)}
        className={`flex min-w-0 items-center gap-1 rounded-field px-1 ${current ? 'bg-primary text-primary-content' : 'hover:bg-base-300'}`}
      >
        {renaming ? (
          <input
            className="input input-xs min-w-0 flex-1"
            aria-label={t('editor.rename')}
            defaultValue={node.name}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key !== 'Escape') return;
              event.currentTarget.value = node.name;
              setRenaming(false);
            }}
            onBlur={(event) => {
              actions.rename(node, event.currentTarget.value);
              setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={`min-w-0 flex-1 truncate py-1 text-left text-sm ${node.visible ? '' : 'opacity-50'}`}
            aria-current={current || undefined}
            title={label}
            onClick={() => session.select(node)}
            onDoubleClick={() => setRenaming(true)}
          >
            {label}
          </button>
        )}
        <Button
          size="sm"
          className="btn-xs"
          aria-pressed={node.visible}
          aria-label={t(node.visible ? 'editor.hide' : 'editor.show')}
          title={t(node.visible ? 'editor.hide' : 'editor.show')}
          onClick={() => actions.setVisible(node, !node.visible)}
        >
          {node.visible ? '●' : '○'}
        </Button>
      </div>
      {node.children.length > 0 && (
        <ul className="pl-3">
          {node.children.map((child) => (
            <Row key={child.id} editor={editor} node={child} dragged={dragged} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The scene's tree, its helper marks left out: a click selects, a drag onto another row puts the
 * object under it, a drag onto the empty part of the panel puts it back at the top of the scene.
 */
export function Outliner({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const dragged = useRef<Object3D | null>(null);
  const roots = editor.session.content;
  const scene = editor.session.world.scene;
  return (
    <nav
      aria-label={t('editor.outliner')}
      className="grid min-h-0 content-start gap-2 overflow-y-auto"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => dropOn(event, editor, dragged, scene)}
    >
      <h2 className="text-xs font-bold uppercase tracking-widest opacity-60">
        {t('editor.outliner')}
      </h2>
      {roots.length === 0 ? (
        <Note>{t('editor.empty')}</Note>
      ) : (
        <>
          <ul className="grid gap-0.5">
            {roots.map((node) => (
              <Row key={node.id} editor={editor} node={node} dragged={dragged} />
            ))}
          </ul>
          <Note>{t('editor.dropRoot')}</Note>
        </>
      )}
    </nav>
  );
}
