import type { Explorer } from '../../../packages/sdk-browser/index.ts';
import type { SceneCopy } from './content.ts';

export function createLightingControls(
  explorer: Explorer,
  light: HTMLInputElement,
  lightValue: HTMLElement,
  shadows: HTMLInputElement,
  copy: SceneCopy,
  invalidate: () => void,
) {
  const sources = explorer.importedLights().map(({ id, intensity, castsShadow }) => ({
    id,
    intensity,
    castsShadow,
  }));
  const apply = () => {
    const scale = Number(light.value);
    lightValue.textContent = `${copy.lightValue}${scale.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
    for (const source of sources)
      explorer.setLight(source.id, {
        intensity: source.intensity * scale,
        castsShadow: source.castsShadow && shadows.checked,
      });
    invalidate();
  };
  return {
    apply,
    hasLights: sources.length > 0,
    hasShadows: sources.some((source) => source.castsShadow),
  };
}
