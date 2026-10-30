# Dynamic geometry

Geometry rewritten every frame ([SDK.md](../sdk/canvas-camera-and-teardown/geometry-rewritten-every-frame.md#geometry-rewritten-every-frame)) is cut into pages
once and its changed vertices written in place (`world/dynamic/dynamic.ts`) into the float
vertex pool (`pages/pool/geometryPrepare.ts`).
