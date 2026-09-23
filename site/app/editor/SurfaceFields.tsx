import type { Color, Light, Material, Object3D } from '../../../packages/sdk-browser/src/index.ts';
import { useWords } from '../i18n.ts';
import { usePortal } from '../layout/PortalContext.ts';
import { ColorField } from '../ui/ColorField.tsx';
import { Field, ToggleField } from '../ui/Input.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { valueCommand } from './commands.ts';
import { isLight, materialOf } from './objects.ts';
import type { Editor } from './useEditor.ts';

type Commit = Editor['session']['run'];

/** A colour of a material or a light: live while the picker moves, one command when it closes. */
function colourField(label: string, colour: Color, run: Commit) {
  const paint = (hex: string) => colour.set(hex);
  return (
    <ColorField
      label={label}
      value={colour.getStyle()}
      onLive={paint}
      onCommit={(before, after) => run(valueCommand(paint, before, after))}
    />
  );
}

/** A number of `target` under `key`, one command per commit; `write` sets it with what follows. */
function numberField<T extends object>(
  label: string,
  target: T,
  key: keyof T & string,
  run: Commit,
  write: (value: number) => void = (value) => Object.assign(target, { [key]: value }),
  range: { min?: number; max?: number; step?: number } = {},
) {
  return (
    <NumberField
      key={key}
      label={label}
      value={target[key] as number}
      step={range.step ?? 0.05}
      min={range.min ?? 0}
      max={range.max}
      onCommit={(value) => run(valueCommand(write, target[key] as number, value))}
    />
  );
}

function MaterialFields({ material, run }: { material: Material; run: Commit }) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const unit = { min: 0, max: 1, step: 0.05 };
  // Below full opacity the surface lets what is behind show: `transparent` follows, and the world
  // reopens its session for it — which is why opacity is committed, never live.
  const setOpacity = (value: number) =>
    Object.assign(material, { transparent: value < 1, opacity: value });
  return (
    <Field label={t('editor.material')}>
      {colourField(t('editor.color'), material.color, run)}
      {numberField(t('editor.metalness'), material, 'metalness', run, undefined, unit)}
      {numberField(t('editor.roughness'), material, 'roughness', run, undefined, unit)}
      {colourField(t('editor.emissive'), material.emissive, run)}
      {numberField(t('editor.opacity'), material, 'opacity', run, setOpacity, unit)}
    </Field>
  );
}

function LightFields({ light, run }: { light: Light; run: Commit }) {
  const { locale } = usePortal().route;
  const t = useWords(locale);
  const reaches = light.kind === 'point' || light.kind === 'spot';
  // `castShadow` is a plain field: `needsUpdate` tells the world the light changed.
  const setShadow = (on: boolean) => {
    light.castShadow = on;
    light.needsUpdate = true;
  };
  return (
    <Field label={t('editor.light')}>
      {colourField(t('editor.color'), light.color, run)}
      {numberField(t('editor.intensity'), light, 'intensity', run, undefined, {
        step: 0.5,
      })}
      {reaches && numberField(t('editor.range'), light, 'distance', run, undefined, { step: 1 })}
      {light.kind !== 'ambient' && (
        <ToggleField
          label={t('editor.shadow')}
          checked={light.castShadow}
          onChange={(event) =>
            run(valueCommand(setShadow, light.castShadow, event.currentTarget.checked))
          }
        />
      )}
    </Field>
  );
}

/** The selected object's matter: its material's fields for a mesh, its light's for a light. */
export function SurfaceFields({ editor, node }: { editor: Editor; node: Object3D }) {
  const run = editor.session.run;
  const material = materialOf(node);
  if (material) return <MaterialFields material={material} run={run} />;
  return isLight(node) ? <LightFields light={node} run={run} /> : null;
}
