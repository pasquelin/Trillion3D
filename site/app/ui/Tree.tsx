import { useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Button } from './Button.tsx';
import { QUIET_FOCUS } from './Input.tsx';

interface TreeLabels {
  rename: string;
  show: string;
  hide: string;
}

interface TreeProps<T> {
  /** The top rows. */
  nodes: readonly T[];
  keyOf: (node: T) => string | number;
  labelOf: (node: T) => string;
  childrenOf: (node: T) => readonly T[];
  /** The name the rename field starts from. */
  nameOf: (node: T) => string;
  visibleOf: (node: T) => boolean;
  selected: T | null;
  onSelect: (node: T) => void;
  onRename: (node: T, name: string) => void;
  onVisible: (node: T, visible: boolean) => void;
  /** A row dropped on another (`parent`), or on the tree's empty part (`null`). */
  onMove: (node: T, parent: T | null) => void;
  labels: TreeLabels;
  className?: string;
  /** Shown under the rows, inside the drop area of the top level. */
  footer?: ReactNode;
}

type RowProps<T> = Omit<TreeProps<T>, 'nodes' | 'className' | 'footer'> & {
  node: T;
  /** The row being dragged, shared by every row of the tree. */
  dragged: { current: T | null };
};

/** Hands the dragged row to `onMove` under `parent`, once. */
function drop<T>(
  event: DragEvent,
  props: Pick<RowProps<T>, 'dragged' | 'onMove'>,
  parent: T | null,
) {
  event.preventDefault();
  event.stopPropagation();
  if (props.dragged.current !== null) props.onMove(props.dragged.current, parent);
  props.dragged.current = null;
}

/** The field a row turns into while renamed: Enter or leaving commits, Escape cancels. */
function RenameField({
  name,
  label,
  onDone,
}: {
  name: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  return (
    <input
      className={`input input-xs min-w-0 flex-1 ${QUIET_FOCUS}`}
      aria-label={label}
      defaultValue={name}
      autoFocus
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key !== 'Escape') return;
        event.currentTarget.value = name;
        onDone(null);
      }}
      onBlur={(event) => onDone(event.currentTarget.value)}
    />
  );
}

/** One row: its label (a click selects, a double click renames), its eye, then its children. */
function Row<T>(props: RowProps<T>) {
  const { node, dragged, selected, labels } = props;
  const [renaming, setRenaming] = useState(false);
  const current = selected === node;
  const visible = props.visibleOf(node);
  const label = props.labelOf(node);
  const children = props.childrenOf(node);
  const eye = visible ? labels.hide : labels.show;
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
        onDrop={(event) => drop(event, props, node)}
        className={`flex min-w-0 items-center gap-1 rounded-field px-1 ${current ? 'bg-primary text-primary-content' : 'hover:bg-base-300'}`}
      >
        {renaming ? (
          <RenameField
            name={props.nameOf(node)}
            label={labels.rename}
            onDone={(name) => {
              if (name !== null) props.onRename(node, name);
              setRenaming(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={`min-w-0 flex-1 truncate py-1 text-left text-sm ${visible ? '' : 'opacity-50'}`}
            aria-current={current || undefined}
            title={label}
            onClick={() => props.onSelect(node)}
            onDoubleClick={() => setRenaming(true)}
          >
            {label}
          </button>
        )}
        <Button
          size="sm"
          className="btn-xs"
          aria-pressed={visible}
          aria-label={eye}
          title={eye}
          onClick={() => props.onVisible(node, !visible)}
        >
          {visible ? '●' : '○'}
        </Button>
      </div>
      {children.length > 0 && (
        <ul className="pl-3">
          {children.map((child) => (
            <Row key={props.keyOf(child)} {...props} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A tree of rows, knowing nothing of what they stand for: a click selects, a double click renames,
 * the eye shows or hides, a drag onto another row moves the row under it, and a drag onto the
 * tree's empty part moves it back to the top level.
 */
export function Tree<T>({ nodes, className = '', footer, ...props }: TreeProps<T>) {
  const dragged = useRef<T | null>(null);
  return (
    <div
      className={className}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => drop(event, { dragged, onMove: props.onMove }, null)}
    >
      <ul className="grid gap-0.5">
        {nodes.map((node) => (
          <Row key={props.keyOf(node)} {...props} node={node} dragged={dragged} />
        ))}
      </ul>
      {footer}
    </div>
  );
}
