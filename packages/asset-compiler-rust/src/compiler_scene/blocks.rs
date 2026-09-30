//! Preserve source blocks beside the scene. Existing cooked pixels remain the capability fallback.
use crate::{
    compiler_storage::{product, Product},
    plugins::image,
    texture_preview::source,
};
use crate::{Options, Result};
use serde_json::{json, Value};
use std::path::Path;

const FORMATS: &[&str] = &[
    "bc1-rgba-unorm",
    "bc2-rgba-unorm",
    "bc3-rgba-unorm",
    "bc4-r-unorm",
    "bc5-rg-unorm",
    "bc7-rgba-unorm",
    "etc2-rgb8unorm",
    "etc2-rgb8a1unorm",
    "etc2-rgba8unorm",
    "eac-r11unorm",
    "eac-rg11unorm",
    "astc-4x4-unorm",
];

pub(super) fn publish(
    g: &Value,
    bin: &[u8],
    root: &Path,
    directory: &Path,
    output: &mut Value,
    options: &Options,
    reserved_bytes: usize,
) -> Result<Vec<Product>> {
    let mut products = Vec::new();
    let budget = (options.ram_budget_bytes().saturating_sub(reserved_bytes) / 2)
        .min(512 * 1024 * 1024) as u64;
    let Some(images) = g["images"].as_array() else {
        return Ok(products);
    };
    for (rank, descriptor) in images.iter().enumerate() {
        crate::check(options)?;
        let extras = &output["images"][rank]["extras"];
        if !extras.is_null() && !extras.is_object() {
            continue;
        }
        // Mapped input is not copied; the reservation also covers concatenating the levels.
        let blocks = source::with_image_bytes(g, bin, root, descriptor, |bytes, _| {
            image::decode_for_gpu(bytes, budget, FORMATS)
        });
        // Failure leaves the established pixel decoder and its named diagnostics in charge.
        let Ok(Some(image::ImageDecoded {
            image: image::DecodedImage::Blocks(blocks),
            ..
        })) = blocks
        else {
            continue;
        };
        let length = blocks.levels.iter().map(|level| level.data.len()).sum();
        let mut payload = Vec::with_capacity(length);
        let mut levels = Vec::new();
        for level in &blocks.levels {
            levels.push(json!({"width":level.width,"height":level.height,
                "offset":payload.len(),"length":level.data.len()}));
            payload.extend_from_slice(&level.data);
        }
        let file = format!("compressed-image-{rank}.bin");
        products.push(product(directory, &file, &payload)?);
        output["images"][rank]["extras"]["trillion3dCompressed"] = json!({
            "uri":file, "blockFormat":blocks.format, "levels":levels,
            "transfer":if blocks.transfer == image::Transfer::Srgb { "srgb" } else { "linear" },
        });
    }
    Ok(products)
}
