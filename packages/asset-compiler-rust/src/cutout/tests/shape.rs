//! What measurement sees. Images constructed here texel by texel: leaf is
//! disc with softened edge, window is uniform veil, between the two is gradient
//! covering entire surface — shape no cutout has.
use super::*;

/// Disc of radius  entirely present, absent beyond , softened between the two.
fn sheet_image(plein: f32, vide: f32) -> image::RgbaImage {
    image::RgbaImage::from_fn(64, 64, |x, y| {
        let (dx, dy) = (x as f32 - 31.5, y as f32 - 31.5);
        let rayon = (dx * dx + dy * dy).sqrt();
        let part = ((vide - rayon) / (vide - plein)).clamp(0.0, 1.0);
        image::Rgba([40, 120, 40, (part * 255.0).round() as u8])
    })
}

fn uniform_image(alpha: u8) -> image::RgbaImage {
    image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 200, 220, alpha]))
}

// Behavior: leaf with edge softened over three pixels proposed as cutout — almost all
// its alpha is at 0 or 1, intermediate texels live only along contour.
#[test]
fn a_leaf_with_a_soft_edge_is_proposed_as_cutout() {
    let shape = measure(&sheet_image(18.0, 21.0));
    assert!(shape.between < 0.25, "in-between share {}", shape.between);
    assert!(
        shape.at_contour > 0.99,
        "stuck to the contour {}",
        shape.at_contour
    );
    assert!(shape.looks_like_cutout());
}

// Behavior: window — uniform veil halfway — never proposed as cutout. It
// has no contour at all, so not a single intermediate is adjacent to border.
#[test]
fn a_uniform_pane_stays_blended() {
    let shape = measure(&uniform_image(77));
    assert_eq!(shape.between, 1.0);
    assert_eq!(shape.at_contour, 0.0);
    assert!(!shape.looks_like_cutout());
}

// Behavior: gradient across entire image has contour, but intermediates
// are far. Edge case intermediate fraction alone cannot separate from
// very soft leaf, location decides.
#[test]
fn a_full_frame_gradient_stays_blended() {
    let image = image::RgbaImage::from_fn(64, 64, |x, _| {
        image::Rgba([180, 180, 180, (x * 255 / 63) as u8])
    });
    let shape = measure(&image);
    assert!(shape.between > 0.9, "in-between share {}", shape.between);
    // Two thirds of intermediate texels far from contour: leaf has none.
    assert!(
        shape.at_contour < 0.4,
        "stuck to the contour {}",
        shape.at_contour
    );
    assert!(!shape.looks_like_cutout());
}

// Behavior: texture with no empty space has nothing to cut out, even without intermediates. An
// all-ones alpha is opaque surface, masking removes no pixels.
#[test]
fn a_texture_without_holes_has_nothing_to_cut() {
    let shape = measure(&uniform_image(255));
    assert_eq!(shape.present, 1.0);
    assert!(!shape.looks_like_cutout());
}

// Behavior: fence mesh — binary alpha, no intermediates — proposed as
// cutout. Shape reference expects, measurement does not reject for lack of border.
#[test]
fn an_already_binary_alpha_is_proposed_as_cutout() {
    let image = image::RgbaImage::from_fn(64, 64, |x, y| {
        let plein = (x / 4) % 2 == 0 || (y / 4) % 2 == 0;
        image::Rgba([90, 90, 90, if plein { 255 } else { 0 }])
    });
    let shape = measure(&image);
    assert_eq!(shape.between, 0.0);
    assert!(shape.looks_like_cutout());
}

// Behavior: measurement reads full resolution, border width counted in source
// pixels. Same disc in image twice as large keeps three-pixel border and
// stays cutout; test fixes that band does not scale with image.
#[test]
fn the_band_is_counted_in_source_pixels() {
    let large = image::RgbaImage::from_fn(128, 128, |x, y| {
        let (dx, dy) = (x as f32 - 63.5, y as f32 - 63.5);
        let rayon = (dx * dx + dy * dy).sqrt();
        let part = ((45.0 - rayon) / 3.0).clamp(0.0, 1.0);
        image::Rgba([40, 120, 40, (part * 255.0).round() as u8])
    });
    assert!(measure(&large).looks_like_cutout());
}
