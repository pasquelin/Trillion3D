//! Uncompressed surfaces of the DDS container: the same sixteen pixels written in the three
//! declared byte orders. Order is a way of writing an image, never of changing it.
use super::{bytes, check, SIDE};

/// The sixteen reference pixels of uncompressed surfaces, top row first.
const PIXELS: [[u8; 4]; 16] = [
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 255, 255],
    [255, 255, 0, 64],
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [17, 34, 51, 68],
    [200, 100, 50, 150],
    [10, 20, 30, 40],
    [240, 230, 220, 210],
    [1, 2, 3, 4],
    [250, 251, 252, 253],
    [128, 128, 128, 128],
    [0, 128, 255, 32],
    [255, 128, 0, 224],
    [64, 96, 128, 160],
];

// Driver contract for uncompressed surfaces: byte order is a way of writing the same image,
// never of changing it, and `BGRX8` has no alpha — its surface is opaque.
#[test]
fn uncompressed_surfaces_yield_the_same_image_in_all_three_orders() {
    let rgba: Vec<u8> = PIXELS.iter().flatten().copied().collect();
    let bgra: Vec<u8> = PIXELS
        .iter()
        .flat_map(|[red, green, blue, alpha]| [*blue, *green, *red, *alpha])
        .collect();
    let bgrx: Vec<u8> = PIXELS
        .iter()
        .flat_map(|[red, green, blue, _]| [*blue, *green, *red, 0x7f])
        .collect();
    let opaque: Vec<[u8; 4]> = PIXELS
        .iter()
        .map(|[red, green, blue, _]| [*red, *green, *blue, 255])
        .collect();
    for (case, masks, payload, expected) in [
        (
            "rgba8",
            [0xff, 0xff00, 0xff_0000, 0xff00_0000],
            &rgba,
            PIXELS.to_vec(),
        ),
        (
            "bgra8",
            [0xff_0000, 0xff00, 0xff, 0xff00_0000],
            &bgra,
            PIXELS.to_vec(),
        ),
        ("bgrx8", [0xff_0000, 0xff00, 0xff, 0], &bgrx, opaque),
    ] {
        let format = bytes::mask_format(32, masks);
        check(
            case,
            &bytes::container(format, SIDE, SIDE, 1, payload),
            &expected,
        );
    }
    check(
        "dxgi bgra8",
        &bytes::dx10(87, SIDE, SIDE, &bgra),
        PIXELS.as_ref(),
    );
}
