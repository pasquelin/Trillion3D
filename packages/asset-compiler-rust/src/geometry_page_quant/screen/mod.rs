//! Measured screen error of the drawn pages. A primitive goes through the
//! compiler's own page path (`build_dag_primitive`, its grid from `tile_log2`), every page it
//! stores is read back from the cache and decoded by the reader's decoder, and each decoded
//! corner is compared with the source vertex it stands for: the largest distance is the page's
//! measured displacement. The engine's cut projection (`cut_error::node_ceiling_error`) then
//! turns it into pixels on a screen of 1080 lines under a 60° vertical field.
//!
//! A page is drawn from the depth where its own error projects to the threshold (never nearer
//! than the camera) until its parent's does: its worst screen error is its error plus its
//! measured displacement, projected at the nearest depth it is drawn at. The criterion:
//! no drawn page further than `pixelError + 0.1` pixel from the source.
mod building;
mod criterion;
mod meshes;
mod tests;
mod vegetation;

use crate::compiler_primitive_dag::{build_dag_primitive, DagResult};
use criterion::{assert_within_margin, exact_pixels, MARGIN};
use std::collections::HashMap;
use std::sync::Mutex;
use trillion3d_math::vec3::point;
use trillion3d_math::vecn::{length, sub};
use trillion3d_page_codec::encode::Attribute;

/// A stored page, in metres of the world: its level, its error and its parent's (none for a
/// root), and the largest distance of a decoded corner to its source vertex.
struct Page {
    level: u32,
    error: f64,
    parent: Option<f64>,
    shift: f64,
}

/// A primitive as the compiler holds it: positions, carried attributes, triangles, whether it
/// blends, the largest world scale it is placed under, and its tile (`bits::grid::tile_log2`).
struct Primitive<'a> {
    positions: &'a [f32],
    carried: &'a [&'a Attribute],
    indices: &'a [u32],
    blended: bool,
    scale: Option<f64>,
    tile_log2: i32,
}

/// Largest distance between a decoded corner and the source vertex it stands for.
fn displacement(bytes: &[u8], slice: &[u32], positions: &[f32]) -> f64 {
    let page = trillion3d_page_codec::decode(bytes, 64 << 20).expect("stored page decodes");
    let decoded = page.attribute(0).expect("positions");
    slice
        .iter()
        .zip(page.indices())
        .map(|(&source, &local)| length(sub(point(decoded, local), point(positions, source))))
        .fold(0.0, f64::max)
}

/// Every page of `primitive`, compiled into a scratch cache and measured back from it.
fn measure(primitive: &Primitive) -> Vec<Page> {
    let root = crate::tests::directories::scratch("geometry-page", "screen-error");
    let mut o = crate::tests::fixtures::options_in(&root);
    o.simplification = "qem-endpoints".into();
    std::fs::create_dir_all(o.cache.join("native/objects")).expect("objects");
    let triangles = primitive.indices.len() / 3;
    let demand = crate::proxy::cut::cut_demand(
        primitive.scale,
        trillion3d_page_codec::proxy::PROXY_TRIANGLE_BUDGET,
        triangles,
        triangles,
    );
    let uv = super::primitive_uv_exponent(primitive.carried, primitive.blended);
    let shifts = Mutex::new(HashMap::new());
    // The pages read the grown arrays: a solved reduction's placed vertices follow the source's.
    let encode = |slice: &[u32], positions: &[f32], carried: &[&_], _: &[u32], exponent: i32| {
        let (value, bytes, cone) = crate::compiler_page_record::encode_page(
            slice,
            (positions, carried),
            (&Default::default(), &[]),
            (exponent, uv),
        )?;
        let digest = crate::hash(&bytes);
        let shift = displacement(&bytes, slice, positions);
        // The header's error is what the manifest's `maxPositionError` and the run-time cut read.
        let published = value["quantizationError"]
            .as_f64()
            .expect("quantization error");
        assert!(
            shift <= published * (1.0 + 1e-6) + 1e-9,
            "{shift} > {published}"
        );
        // Two slices may encode to one page: it keeps the larger displacement of the two.
        let mut shifts = shifts.lock().expect("shifts");
        let kept = shifts.entry(digest).or_insert(0.0_f64);
        *kept = kept.max(shift);
        Ok((value, bytes, cone))
    };
    let DagResult {
        pages, page_run, ..
    } = build_dag_primitive(
        &o,
        primitive.positions,
        primitive.carried,
        primitive.indices,
        demand,
        primitive.blended,
        crate::voxel::ShapePreservation::None,
        (primitive.tile_log2, primitive.scale),
        &encode,
    )
    .expect("the primitive compiles");
    // Each page's digest, read from its bundle in the primitive's run.
    let run = page_run.expect("pages");
    let bytes = std::fs::read(&run.path).expect("the run");
    let digest_of = |page: &serde_json::Value| {
        let at = |value: &serde_json::Value, key: &str| value[key].as_u64().expect(key) as usize;
        let start = run.bundles[at(page, "stream")].start + at(page, "streamOffset");
        crate::hash(&bytes[start..start + at(&page["geometry"], "bytes")])
    };
    std::fs::remove_dir_all(&root).ok();
    let shifts = shifts.into_inner().expect("shifts");
    let metres = primitive.scale.unwrap_or(1.0);
    pages
        .iter()
        .map(|page| Page {
            level: page["level"].as_u64().expect("level") as u32,
            error: page["lodError"].as_f64().expect("error") * metres,
            parent: page["parentError"].as_f64().map(|e| e * metres),
            shift: shifts[&digest_of(page)] * metres,
        })
        .collect()
}
