import type { Light } from '../../../packages/sdk-browser/src/index.ts';
import type { SceneCopy } from './content.ts';

export function createLightingControls(
  lights: readonly Light[],
  light: HTMLInputElement,
  lightValue: HTMLElement,
  shadows: HTMLInputElement,
  copy: SceneCopy,
  invalidate: () => void,
) {
  // Each live light keeps its own base intensity and shadow flag, read once when the model loads:
  // the slider and the checkbox then scale and gate them, never re-declaring the light itself.
  const sources = lights.map((source) => ({
    source,
    intensity: source.intensity,
    castShadow: source.castShadow,
  }));
  const apply = () => {
    const scale = Number(light.value);
    lightValue.textContent = `${copy.lightValue}${scale.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
    for (const { source, intensity, castShadow } of sources) {
      source.intensity = intensity * scale;
      source.castShadow = castShadow && shadows.checked;
    }
    invalidate();
  };
  return {
    apply,
    hasLights: sources.length > 0,
    hasShadows: sources.some((source) => source.castShadow),
  };
}
