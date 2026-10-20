//! The criterion the measured pages answer: each drawn page's worst screen error, projected by the
//! engine's cut, against the threshold plus its margin.
use super::Page;
use trillion3d_page_codec::cut::error::{node_ceiling_error, Lens};

/// Focal length in pixels of 1080 lines under a 60° vertical field.
const FOCAL: f64 = 540.0 / 0.577_350_269_189_625_8;
/// Camera distances the error is read at, in metres.
const DISTANCES: [f64; 2] = [2.0, 10.0];
/// The thresholds, in pixels.
const PIXEL_ERRORS: [f64; 3] = [0.5, 1.0, 2.0];
/// What a drawn page may add to the threshold, in pixels.
pub(super) const MARGIN: f64 = 0.1;

/// The cut's lens, the camera at the origin looking down `−z`: the view is the identity.
fn lens() -> Lens {
    Lens {
        view: std::array::from_fn(|i| f64::from(u8::from(i % 5 == 0))),
        stretch: 1.0,
        focal: FOCAL,
        near: 1e-3,
        perspective: 1.0,
    }
}

/// `error` metres at `depth`, projected by the cut in pixels.
fn pixels(error: f64, depth: f64, lens: &Lens) -> f64 {
    node_ceiling_error(error, &[0.0, 0.0, -depth, 0.0], 0, lens).expect("a valid projection")
}

/// The worst screen error of a drawn page, the camera `distance` metres away or further.
fn worst(pages: &[Page], distance: f64, pixel_error: f64) -> f64 {
    let lens = lens();
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
pub(super) fn exact_pixels(pages: &[Page], distance: f64) -> f64 {
    let shift = pages
        .iter()
        .filter(|p| p.level == 0)
        .map(|p| p.shift)
        .fold(0.0, f64::max);
    pixels(shift, distance, &lens())
}

/// Prints `name`'s numbers and asserts the criterion at every distance and threshold.
pub(super) fn assert_within_margin(name: &str, pages: &[Page]) {
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
