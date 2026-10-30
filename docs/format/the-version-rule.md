# The version rule

A file family's bytes for unchanged sources change only with a change of that family's version, the
constant each section below names (the per-format one: `WORLD_ROOTS_VERSION` for `world-roots.*`,
`MANIFEST_BINARY_VERSION` for the column files, and so on; `FORMAT_VERSION` for the pointer, the source
copy and what no family owns). A change of output with no version change leaves old and new caches
sharing a version with different bytes, which a reader cannot tell apart: bump the family's version in
the same change, with its fixtures. The `Compiler` workflow enforces it
(`scripts/native/compiler-hashes.ts`): the five platforms agree byte for byte; against `develop` a
family may differ only when its version differs too, listed `changed on purpose (name vN → vM)`, and a
byte change with no version change fails, naming the version to bump. `clusters.json`, the head page
and the content-addressed objects embed several families and are allowed by any version change.
