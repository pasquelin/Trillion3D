use super::*;
use trillion3d_math::random::xorshift64;

// Behaviour: texture coordinates take the format's grid, coarser only where the widest page
// needs it; a blended primitive takes the finest its span fits.
#[test]
fn drawn_texture_coordinates_take_the_formats_grid_coarser_only_where_the_widest_page_needs_it() {
    for span in [0.0, -0.0, -1.0, f64::NAN] {
        assert_eq!(drawn_uv_grid_exponent(span, false), UV_EXPONENT);
        assert_eq!(drawn_uv_grid_exponent(span, true), UV_EXPONENT);
    }
    assert_eq!(drawn_uv_grid_exponent(1.0, false), UV_EXPONENT);
    assert_eq!(drawn_uv_grid_exponent(4096.0, false), -11);
    assert_eq!(drawn_uv_grid_exponent(1.0, true), -23);
    // A blended primitive's grid is the finest its span fits, coarser than the format's if need be.
    assert_eq!(drawn_uv_grid_exponent(f64::from(1u32 << 20), true), -3);
    let mut state = 1u64;
    for i in 0..10_000 {
        let unit = (xorshift64(&mut state) >> 11) as f64 / (1u64 << 53) as f64;
        let span = (unit * 60.0 - 30.0).exp2();
        let exponent = drawn_uv_grid_exponent(span, i % 2 == 1);
        assert!(
            span / f64::from(exponent).exp2() < f64::from(1u32 << MAX_BITS),
            "{span}"
        );
    }
}
