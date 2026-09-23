import type { Geometry, Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { t } from '../../content/i18n/index.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Field, NumberField } from '../ui/Input.tsx';
import { valueCommand } from './commands.ts';
import { isMesh, shapeBuilder, SHAPES } from './objects.ts';
import type { Editor } from './useEditor.ts';

/**
 * The numbers the selected mesh's shape was built from (`geometry.recipe`), each one editable:
 * a commit builds the shape again through its family member and swaps it in, one command. A shape
 * that no family call records has no fields.
 */
export function GeometryFields({ editor, node }: { editor: Editor; node: Object3D }) {
  const { locale } = usePortal().route;
  const { session } = editor;
  const recipe = isMesh(node) ? node.geometry.recipe : null;
  const rebuild = recipe && shapeBuilder(session.engine, recipe.type);
  if (!isMesh(node) || !recipe || !rebuild) return null;
  const names: readonly string[] = SHAPES[recipe.type as keyof typeof SHAPES] ?? [];
  const setArg = (index: number, value: number) => {
    const args = [...recipe.args];
    args[index] = value;
    // The family builds at least the pieces a shape closes with, and its recipe says how many:
    // a count below that comes back as the fewest, and one that changes nothing is no edit.
    const shape = rebuild(...args);
    if (String(shape.recipe?.args) === String(recipe.args)) return;
    const swap = (next: Geometry) => (node.geometry = next);
    session.run(valueCommand(swap, node.geometry, shape));
  };
  return (
    <Field label={`${t(locale, 'editor.geometry')} · ${recipe.type}`}>
      <div className="grid grid-cols-2 gap-1">
        {recipe.args.map((arg, index) =>
          typeof arg === 'number' ? (
            <NumberField
              key={index}
              label={names[index] ? t(locale, `editor.param.${names[index]}`) : `#${index + 1}`}
              value={arg}
              step={Number.isInteger(arg) ? 1 : 0.1}
              min={0}
              onCommit={(value) => setArg(index, value)}
            />
          ) : null,
        )}
      </div>
    </Field>
  );
}
