import type { Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { t } from '../../content/i18n/index.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Field } from '../ui/Input.tsx';
import { Note } from '../ui/Text.tsx';
import { poseCommand, poseOf } from './commands.ts';
import { NumberField, TextField } from './fields.tsx';
import { GeometryFields } from './GeometryFields.tsx';
import type { Editor } from './useEditor.ts';
import { SurfaceFields } from './SurfaceFields.tsx';

const AXES = ['x', 'y', 'z'] as const;
const DEGREES = 180 / Math.PI;

/** The three rows of the pose: position, rotation shown in degrees, scale. */
function poseRows(node: Object3D) {
  return [
    { key: 'editor.position', read: node.position, factor: 1, step: 0.1 },
    { key: 'editor.rotation', read: node.rotation, factor: DEGREES, step: 5 },
    { key: 'editor.scaleField', read: node.scale, factor: 1, step: 0.1 },
  ] as const;
}

/**
 * The selected object's properties: its name, its pose (the numbers the handles move, shown again
 * after each of their changes), then its shape, its material or its light. Each commit is one
 * command of the history.
 */
export function Inspector({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const { session, actions } = editor;
  const node = session.selected;
  if (!node) return <Note>{t(locale, 'editor.nothing')}</Note>;
  /** One axis of one row set to `value`, recorded as a change of pose. */
  const setAxis = (row: ReturnType<typeof poseRows>[number], axis: number, value: number) => {
    const before = poseOf(node);
    const next = AXES.map((name) => row.read[name]);
    next[axis] = value / row.factor;
    row.read.set(next[0], next[1], next[2]);
    session.record(poseCommand(node, before, poseOf(node)));
  };
  return (
    <div className="grid grid-cols-1 gap-2">
      <TextField
        label={t(locale, 'editor.name')}
        value={node.name}
        onCommit={(name) => actions.rename(node, name)}
      />
      {poseRows(node).map((row) => (
        <Field key={row.key} label={t(locale, row.key)}>
          <div className="grid grid-cols-3 gap-1">
            {AXES.map((name, axis) => (
              <NumberField
                key={name}
                label={name}
                value={row.read[name] * row.factor}
                step={row.step}
                onCommit={(value) => setAxis(row, axis, value)}
              />
            ))}
          </div>
        </Field>
      ))}
      <GeometryFields editor={editor} node={node} />
      <SurfaceFields editor={editor} node={node} />
    </div>
  );
}
