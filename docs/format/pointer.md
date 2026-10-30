# Pointer

`manifest.json`: status, format, key, scope (`slice` or `full`) and the URL of `clusters.json`.

- Versions: `FORMAT_VERSION` 11, `CLUSTERED_BLEND_FORMAT_VERSION` 12
  (`rust/compiler/cache/format.rs:cache_format` picks; `core/contracts/base.ts`).
- Writes `rust/compiler/cache/publish.rs:write_pointer`; reads `core/contracts/cache.ts:assertCachePointer`.
