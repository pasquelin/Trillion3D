export function createLightingControls(explorer, light, lightValue, shadows, copy, invalidate) {
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
