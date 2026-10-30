# A see-through surface casts no shadow

A blended material (`transparent: true`) lets light pass, as glass, smoke and a light beam do, and
draws nothing into the shadow maps: `material.meshStandard({ transparent: true, opacity: 0.5 })` casts
no shadow, whatever its opacity. An opaque or cutout surface behind it still casts its own.
