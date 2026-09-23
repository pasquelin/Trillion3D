import { useRef } from 'react';
import { t } from '../../content/i18n/index.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { Dropdown } from '../ui/Dropdown.tsx';
import { LIGHTS, SHAPES, type AddKind } from './objects.ts';
import type { Editor } from './useEditor.ts';

/** The public cooked models the Models menu loads, each committed under `site/assets/examples`. */
const MODELS = ['bust', 'crates', 'hall', 'street-corner'] as const;
const manifestOf = (id: string) =>
  new URL(`assets/examples/${id}/cache/native/full/manifest.json`, document.baseURI).href;

/** Hands the scene to the person as a JSON file. */
function download(json: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  link.download = 'scene.json';
  link.click();
  // Revoked on the next task: some browsers start the download after `click` returns.
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

/**
 * The editor's menu bar: File (new, open a JSON file, save one), Add (the shapes, a group, the
 * lights), Edit (undo, redo, duplicate, delete) and Models (a public cooked model, loaded).
 */
export function MenuBar({ editor }: { editor: Editor }) {
  const { locale } = usePortal().route;
  const { session, actions, failed } = editor;
  const file = useRef<HTMLInputElement>(null);
  const kinds: AddKind[] = [...(Object.keys(SHAPES) as AddKind[]), 'group', ...LIGHTS];
  const none = !session.selected;
  const item = (key: string, onSelect: () => void, disabled = false) => ({
    key,
    label: t(locale, `editor.${key}`),
    onSelect,
    disabled,
  });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          chosen
            ?.text()
            .then((text) => actions.open(JSON.parse(text)))
            .catch(failed);
        }}
      />
      <Dropdown
        label={t(locale, 'editor.menu.file')}
        items={[
          item('new', actions.newScene),
          item('openFile', () => file.current?.click()),
          item('save', () => {
            try {
              download(actions.save());
            } catch (error) {
              failed(error);
            }
          }),
        ]}
      />
      <Dropdown
        label={t(locale, 'editor.menu.add')}
        items={kinds.map((kind) => item(`add.${kind}`, () => actions.add(kind)))}
      />
      <Dropdown
        label={t(locale, 'editor.menu.edit')}
        items={[
          item('undo', session.undo, !session.history.canUndo),
          item('redo', session.redo, !session.history.canRedo),
          item('duplicate', actions.duplicate, none),
          item('delete', actions.remove, none),
        ]}
      />
      <Dropdown
        label={t(locale, 'editor.menu.models')}
        items={MODELS.map((id) =>
          item(
            `model.${id}`,
            () => void actions.loadSample(manifestOf(id), t(locale, `editor.model.${id}`)),
          ),
        )}
      />
    </div>
  );
}
