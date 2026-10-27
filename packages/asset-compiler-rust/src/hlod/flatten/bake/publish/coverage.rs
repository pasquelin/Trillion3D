//! The base image's alpha as a published material wears it.
use super::{Coverage, Image, MASK_CUTOFF};
use serde_json::{json, Value};

/// What the base image's alpha is to a material wearing `images`: the first image whose alpha is
/// read at all, else `Opaque`. The published material (`place`) and the ray tracer's flags
/// (`hlod::chain::traced`) both read it from here.
pub(crate) fn coverage_of(images: &[Image]) -> Coverage {
    (images.iter())
        .map(|image| image.coverage)
        .find(|&coverage| coverage != Coverage::Opaque)
        .unwrap_or(Coverage::Opaque)
}

/// The base image's alpha as `coverage` says, written on `material`: its opacity, drawn blended, or
/// its mask, cut at `MASK_CUTOFF`. The published material and the ray tracer's flags
/// (`hlod::chain::traced`) both take it from here.
pub(crate) fn wear_coverage(material: &mut Value, coverage: Coverage) {
    match coverage {
        Coverage::Opaque => {}
        Coverage::Blend => material["alphaMode"] = json!("BLEND"),
        Coverage::Mask => {
            material["alphaMode"] = json!("MASK");
            material["alphaCutoff"] = json!(MASK_CUTOFF);
        }
    }
}
