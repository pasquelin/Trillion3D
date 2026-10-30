# Layout

`native/<scope>/manifest.json`, the pointer, names `native/<scope>/<key>/`: `clusters.json`, its pages
and the products below. Shared objects are `native/objects/<sha256>.bin`, named by content
(`rust/compiler/cache/storage.rs:object_path`); every texture's level chain lives under
`native/textures/v<N>/<sha>/`, one folder per chain source and sheet
(`texture/gate.rs:GateSheet::key`), written once, pruned by folder
(`rust/compiler/cache/prune_textures.rs`).
