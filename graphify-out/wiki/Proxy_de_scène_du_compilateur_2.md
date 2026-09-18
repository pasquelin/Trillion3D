# Proxy de scène du compilateur (2)

> 7 nodes · cohesion 0.33

## Key Concepts

- **SceneProxy** (4 connections) — `packages/asset-compiler-rust/src/proxy.rs`
- **.encode()** (3 connections) — `packages/asset-compiler-rust/src/proxy/encode.rs`
- **SceneProxy** (2 connections) — `packages/asset-compiler-rust/src/proxy/encode.rs`
- **.descriptor()** (2 connections) — `packages/asset-compiler-rust/src/proxy/encode.rs`
- **.node_count()** (2 connections) — `packages/asset-compiler-rust/src/proxy.rs`
- **.triangle_count()** (2 connections) — `packages/asset-compiler-rust/src/proxy.rs`
- **Value** (1 connections)

## Relationships

- [Validation du compilateur](Validation_du_compilateur.md) (1 shared connections)
- [Proxy de scène du compilateur](Proxy_de_scène_du_compilateur.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/proxy.rs`
- `packages/asset-compiler-rust/src/proxy/encode.rs`

## Audit Trail

- EXTRACTED: 9 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*