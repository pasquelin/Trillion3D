use super::*;

/// Final cache retention and wall time, after every publication product is known.
pub(super) fn finish(
    o: &Options,
    key: &str,
    mut result: Value,
    previews: &[crate::texture_preview::TexturePreview],
    started: Instant,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Value> {
    // Prune belongs to the job: the manifest carries `compileMs`, the caller `wallMs` after it.
    let prune_start = Instant::now();
    let keep = Keep::of_result(&result, previews)?;
    let pruned = prune_cache(o, key, keep, progress)?;
    result["metrics"]["pruneMs"] = json!(shared_math::elapsed_ms(prune_start));
    result["metrics"]["wallMs"] = json!(shared_math::elapsed_ms(started));
    progress(json!({"phase":"complete","completed":1,"total":1,"pruned":pruned}));
    Ok(result)
}
