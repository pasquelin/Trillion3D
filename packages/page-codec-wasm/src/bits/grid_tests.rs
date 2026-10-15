use super::*;
use trillion3d_math::random::xorshift64;

// Behaviour: a primitive's texture grid is never coarser than the format's — a blended one
// takes the finest its span fits — and only a page whose own span overflows its field takes a
// coarser grid, alone.
#[test]
fn texture_grids_are_never_coarser_than_the_formats_but_for_an_overflowing_page() {
    for span in [0.0, -0.0, -1.0, f64::NAN] {
        assert_eq!(uv_grid_exponent(span, false), UV_EXPONENT);
        assert_eq!(uv_grid_exponent(span, true), UV_EXPONENT);
    }
    assert_eq!(uv_grid_exponent(1.0, false), UV_EXPONENT);
    assert_eq!(uv_grid_exponent(4096.0, false), UV_EXPONENT);
    assert_eq!(uv_grid_exponent(1.0, true), -23);
    assert_eq!(uv_grid_exponent(f64::from(1u32 << 20), true), UV_EXPONENT);
    // A tiling page of 4096 repeats does not fit 2^-14: that page alone goes to 2^-11.
    assert_eq!(page_uv_exponent(UV_EXPONENT, &[0.0, 0.0, 4096.0, 1.0]), -11);
    assert_eq!(
        page_uv_exponent(UV_EXPONENT, &[0.0, 0.0, 1.0, 1.0]),
        UV_EXPONENT
    );
    let mut state = 1u64;
    for i in 0..10_000 {
        let unit = (xorshift64(&mut state) >> 11) as f64 / (1u64 << 53) as f64;
        let span = (unit * 60.0 - 30.0).exp2();
        let grid = uv_grid_exponent(span, i % 2 == 1);
        assert!(grid <= UV_EXPONENT, "{span}");
        let exponent = page_uv_exponent(grid, &[0.0, 0.0, span as f32, 0.0]);
        assert!(
            f64::from(span as f32) / f64::from(exponent).exp2() < f64::from(1u32 << MAX_BITS),
            "{span}"
        );
    }
}
