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
mod meshes;
mod tests;
mod vegetation;

use crate::compiler_primitive_dag::{build_dag_primitive, DagResult};
use crate::geometry_page::Attribute;
use std::collections::HashMap;
use std::sync::Mutex;
use trillion3d_page_codec::cut_error::{node_ceiling_error, Lens};
use trillion3d_page_codec::vec3::{length, point, sub};

/// Focal length in pixels of 1080 lines under a 60° vertical field.
const FOCAL: f64 = 540.0 / 0.577_350_269_189_625_8;
/// Camera distances the error is read at, in metres.
const DISTANCES: [f64; 2] = [2.0, 10.0];
/// The thresholds, in pixels.
const PIXEL_ERRORS: [f64; 3] = [0.5, 1.0, 2.0];
/// What a drawn page may add to the threshold, in pixels.
const MARGIN: f64 = 0.1;

/// A stored page, in metres of the world: its level, its error and its parent's (none for a
/// root), and the largest distance of a decoded corner to its source vertex.
struct Page {
    level: u32,
    error: f64,
    parent: Option<f64>,
    shift: f64,
}

/// A primitive as the compiler holds it: positions, carried attributes, triangles, whether it
/// blends, the largest world scale it is placed under, and its tile (`tile::tile_log2`).
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
    let root = crate::texture_preview::tests::temp_dir("screen-error");
    let mut o = crate::texture_preview::tests::options(&root);
    o.simplification = "qem-endpoints".into();
    std::fs::create_dir_all(o.cache.join("native/objects")).expect("objects");
    let triangles = primitive.indices.len() / 3;
    let demand = crate::proxy::cut::cut_demand(
        primitive.scale,
        crate::proxy::PROXY_TRIANGLE_BUDGET,
        triangles,
        triangles,
    );
    let uv = super::primitive_uv_exponent(primitive.carried, primitive.blended);
    let shifts = Mutex::new(HashMap::new());
    // The pages read the grown arrays: a solved reduction's placed vertices follow the source's.
    let store = |slice: &[u32], positions: &[f32], carried: &[&_], _: &[u32], exponent: i32| {
        let (value, reused) = crate::compiler_page_object::store_page(
            &o,
            slice,
            (positions, carried),
            (&Default::default(), &[]),
            (exponent, uv),
        )?;
        let digest = value["sha256"].as_str().expect("digest").to_owned();
        let bytes = std::fs::read(crate::object_path(&o, &digest)).expect("stored page");
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
        Ok((value, reused))
    };
    let DagResult { pages, .. } = build_dag_primitive(
        &o,
        primitive.positions,
        primitive.carried,
        primitive.indices,
        demand,
        primitive.blended,
        primitive.tile_log2,
        &store,
    )
    .expect("the primitive compiles");
    std::fs::remove_dir_all(&root).ok();
    let shifts = shifts.into_inner().expect("shifts");
    let metres = primitive.scale.unwrap_or(1.0);
    pages
        .iter()
        .map(|page| Page {
            level: page["level"].as_u64().expect("level") as u32,
            error: page["lodError"].as_f64().expect("error") * metres,
            parent: page["parentError"].as_f64().map(|e| e * metres),
            shift: shifts[page["geometry"]["sha256"].as_str().expect("digest")] * metres,
        })
        .collect()
}

/// The cut's lens at `pixel_error`, the camera at the origin looking down `−z`, nothing culled.
fn lens(pixel_error: f64) -> Lens {
    // Six planes `0·x + 0·y + 0·z + 1` hold every point; the view is the identity.
    Lens {
        planes: std::array::from_fn(|i| f64::from(u8::from(i % 4 == 3))),
        view: std::array::from_fn(|i| f64::from(u8::from(i % 5 == 0))),
        stretch: 1.0,
        focal: FOCAL,
        near: 1e-3,
        perspective: 1.0,
        pixel_error,
        exact: false,
    }
}

/// `error` metres at `depth`, projected by the cut in pixels.
fn pixels(error: f64, depth: f64, lens: &Lens) -> f64 {
    node_ceiling_error(error, &[0.0, 0.0, -depth, 0.0], 0, lens).expect("a valid projection")
}

/// The worst screen error of a drawn page, the camera `distance` metres away or further.
fn worst(pages: &[Page], distance: f64, pixel_error: f64) -> f64 {
    let lens = lens(pixel_error);
    pages
        .iter()
        .filter_map(|page| {
            // `pixels(e, d)` is `e·FOCAL / (d − e)`: the depth where it meets the threshold.
            let depth = distance.max(page.error * (FOCAL / pixel_error + 1.0));
            let replaced = page
                .parent
                .is_some_and(|p| pixels(p, depth, &lens) <= pixel_error);
            (!replaced).then(|| pixels(page.error + page.shift, depth, &lens))
        })
        .fold(0.0, f64::max)
}

/// The finest pages' displacement, in pixels at `distance`: what the grid alone costs.
fn exact_pixels(pages: &[Page], distance: f64) -> f64 {
    let shift = pages
        .iter()
        .filter(|p| p.level == 0)
        .map(|p| p.shift)
        .fold(0.0, f64::max);
    pixels(shift, distance, &lens(1.0))
}

/// Prints `name`'s numbers and asserts the criterion at every distance and threshold.
fn assert_within_margin(name: &str, pages: &[Page]) {
    let shift = pages.iter().map(|p| p.shift).fold(0.0, f64::max);
    println!(
        "{name}: {} pages, largest displacement {:.4} mm",
        pages.len(),
        shift * 1e3
    );
    for distance in DISTANCES {
        let exact = exact_pixels(pages, distance);
        println!("{name} at {distance} m: level 0 {exact:.4} px");
        for pixel_error in PIXEL_ERRORS {
            let drawn = worst(pages, distance, pixel_error);
            println!("{name} at {distance} m, pixelError {pixel_error}: worst {drawn:.4} px");
            assert!(
                drawn <= pixel_error + MARGIN,
                "{name} {distance} m {pixel_error}: {drawn}"
            );
        }
    }
}
