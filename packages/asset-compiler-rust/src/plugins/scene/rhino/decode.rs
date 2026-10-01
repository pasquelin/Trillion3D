//! Decoder limits cover expansion and CPU work; cancellation is checked at stage boundaries.
use super::*;
use cadmpeg_codec_rhino::RhinoCodec;
use cadmpeg_core::{decode::DecodeMode, CodecError};
use cadmpeg_ir::{codec::DecodeResult, Codec, DecodeOptions};
use std::io::Cursor;
pub(super) fn check(request: &SceneRequest<'_>, index: usize) -> Result<()> {
    if super::super::cancel::stopped(request.cancelled, index) {
        return Err(super::super::cancel::refusal());
    }
    Ok(())
}
pub(super) fn read(bytes: &[u8], request: &SceneRequest<'_>) -> Result<DecodeResult> {
    check(request, 0)?;
    let mut options = DecodeOptions::default();
    options.policy.mode = DecodeMode::Strict;
    let budget = request.ram_budget as u64;
    let limits = &mut options.policy.limits;
    limits.max_input_bytes = budget / 8;
    limits.max_decompressed_bytes_total = budget / 8;
    limits.max_decompressed_bytes_per_expand = budget / 8;
    limits.max_materialized_bytes = budget / 8;
    limits.max_retained_bytes = budget / 16;
    limits.max_entities = budget / 1024;
    limits.max_collection_items = budget / 64;
    limits.max_recursion_depth = 128;
    limits.max_work_units = budget.saturating_mul(4);
    let decoded = RhinoCodec
        .decode(&mut Cursor::new(bytes), &options)
        .map_err(|error| match error {
            CodecError::ResourceLimit(_) => {
                crate::CompilerError::new("IMPORT_RESOURCE_LIMIT", format!("3dm: {error}"))
            }
            CodecError::StrictRefusal { .. } | CodecError::NotImplemented(_) => {
                source::unsupported("3dm", error)
            }
            _ => source::invalid("3dm", error),
        })?;
    check(request, 0)?;
    if decoded
        .report()
        .losses
        .iter()
        .any(|loss| loss.code.local_code() == "container.instance-definition-degraded")
    {
        return Err(source::unsupported(
            "3dm",
            "instance-definition integrity or structure degraded",
        ));
    }
    Ok(decoded)
}
