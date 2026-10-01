# Material variants fixture

One hand-authored triangle and three constant-color materials. The two variants intentionally
share the name `paint`; their ranks, not names, identify them. Default is red, variant 0 blue,
and variant 1 green. The extension mappings are deliberately reversed in source order.

The 42-byte binary is nine little-endian float32 position values and three uint16 indices.
`expected.json` contains hand-written expectations. Source semantics follow the Khronos
KHR_materials_variants specification; no external model is downloaded or copied.
