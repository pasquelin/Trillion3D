//! Golden of the KTX 2.0 driver: what the container carries must come out texel for texel.
//!
//! It works on two materials. Files of `tests/fixtures/formats/ktx2/` cover the driver's three paths end to
//! end — an uncompressed level, the same under Zstandard supercompression, and both Basis
//! Universal payloads, UASTC LDR and ETC1S. Tiny containers of `bytes.rs`, written field by
//! field from the specification, cover the codecs named by `vkFormat`: reference values there
//! come from the codec specification, not from the decoder.
//!
//! What the golden does not redo: integer interpolation of BCn blocks, already fixed block by
//! block by the `dds` driver's golden, which goes through the same `image::blocks` base and the
//! same decoder. Here one fixes what is specific to KTX2 — which `vkFormat` leads to which
//! codec, and the geometry of its block, proven by the missing byte.
use super::super::image as registry;
use super::fixture;

mod bytes;
mod codecs;
mod descriptor;
mod refusal;

const MAX_ALLOC: u64 = 64 * 1024 * 1024;
/// Blocks of the declared codecs cover 4 × 4 texels: the golden places exactly one per case.
const SIDE: u32 = 4;
/// `VK_FORMAT_R8G8B8A8_SRGB`, `VK_FORMAT_BC1_RGB_UNORM_BLOCK`, `VK_FORMAT_BC1_RGBA_UNORM_BLOCK`
/// and `VK_FORMAT_ASTC_4x4_UNORM_BLOCK`, the four formats whose texels the golden writes in the
/// open.
const RGBA8_SRGB: u32 = 43;
const BC1_RGB: u32 = 131;
const BC1_RGBA: u32 = 133;
const ASTC_4X4: u32 = 157;

/// Indices of the golden's BC1 block: each line shifts by one, so the four colours of the block
/// appear in the four lines and no position is privileged.
const ORDER: [u8; 16] = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
/// Pure blue and pure red in 565. `colour0 < colour1`: the specification then puts the block in
/// three colours, the third is the integer mean of the two bounds, and index 3 names a black
/// texel — transparent in `BC1_RGBA`, opaque in `BC1_RGB`.
const BLUE_565: u16 = 0x001f;
const RED_565: u16 = 0xf800;

/// A valid container that a refusal case then puts in fault, field by field.
fn valid() -> Vec<u8> {
    bytes::container(RGBA8_SRGB, SIDE, SIDE, &[0u8; 64])
}

/// Decodes a container through the registry, checking along the way that it is indeed this
/// driver that claimed it: the golden proves nothing if another driver answered.
fn decoded(case: &str, file: &[u8]) -> ::image::RgbaImage {
    let decoder = registry::by_head(file).expect("a driver claims these bytes");
    assert_eq!(decoder.name(), "ktx2", "{case}");
    super::rgba8(
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case}: {reason}")),
    )
}

/// Texels of a container, in read order.
fn texels(case: &str, file: &[u8]) -> Vec<[u8; 4]> {
    decoded(case, file)
        .pixels()
        .map(|pixel| pixel.0)
        .collect::<Vec<_>>()
}

/// Sixteen texels of `base.ktx2`: the gradient the fixture writes in the open, channel by
/// channel.
fn base_texels() -> Vec<[u8; 4]> {
    (0..16u32)
        .map(|texel| {
            let (x, y) = (texel % 4, texel / 4);
            [
                (x * 85) as u8,
                (y * 85) as u8,
                ((x + y) * 42) as u8,
                (255 - (x + y) * 17) as u8,
            ]
        })
        .collect()
}

// KTX2 driver golden: an uncompressed level comes out byte for byte, Zstandard supercompression
// does not change a texel of it, and both Basis Universal payloads transcode.
#[test]
fn the_four_fixture_files_each_decode_by_their_own_path() {
    let base = fixture("ktx2", "base.ktx2");
    assert_eq!(texels("base", &base), base_texels());
    // Supercompression is only wrapping: undone, it yields exactly the same bytes.
    let zstd = fixture("ktx2", "base-zstd.ktx2");
    assert_eq!(texels("base-zstd", &zstd), base_texels());
    // UASTC LDR 4 × 4, cut at the top-left corner of the corpus: sixteen blocks, sixteen by sixteen.
    let uastc = decoded("uastc", &fixture("ktx2", "uastc.ktx2"));
    assert_eq!((uastc.width(), uastc.height()), (16, 16));
    // ETC1S under BasisLZ supercompression, as Khronos's encoder wrote it.
    let basis = decoded("basis", &fixture("ktx2", "basis.ktx2"));
    assert_eq!((basis.width(), basis.height()), (256, 256));
    // Both payloads carry the same image the corpus encoded: its corner is a blue gradient, and
    // the four corners of a payload with alpha are never all opaque.
    assert!(basis.get_pixel(0, 0).0[2] > basis.get_pixel(0, 0).0[1]);
}

// KTX2 driver golden: each uncompressed or three-colour `vkFormat` yields the texels the codec
// specification defines, and BC1's alpha bit does separate `_RGB` from `_RGBA`.
#[test]
fn each_declared_vkformat_yields_the_reference_texels() {
    // Uncompressed: the level's bytes are already those of the contract, they come out as-is.
    let level: Vec<u8> = base_texels().into_iter().flatten().collect();
    let plain = bytes::container(RGBA8_SRGB, SIDE, SIDE, &level);
    assert_eq!(texels("rgba8", &plain), base_texels());
    // BC1 in three colours: the two bounds, their integer mean, then the black texel.
    let block = bytes::bc1(BLUE_565, RED_565, ORDER);
    let expect = |black: [u8; 4]| -> Vec<[u8; 4]> {
        let table = [
            [0, 0, 255, 255],
            [255, 0, 0, 255],
            [127, 0, 127, 255],
            black,
        ];
        ORDER.iter().map(|index| table[*index as usize]).collect()
    };
    assert_eq!(
        texels("bc1 rgb", &bytes::container(BC1_RGB, SIDE, SIDE, &block)),
        expect([0, 0, 0, 255]),
        "without an alpha channel, the fourth texel is opaque black"
    );
    assert_eq!(
        texels("bc1 rgba", &bytes::container(BC1_RGBA, SIDE, SIDE, &block)),
        expect([0, 0, 0, 0]),
        "with an alpha channel, the same block yields that texel transparent"
    );
    // ASTC 4 × 4 “void extent”: the colour is written in the open in the block, no
    // interpolation enters the reference.
    let solid = [37u8, 211, 90, 168];
    let astc = bytes::container(ASTC_4X4, SIDE, SIDE, &bytes::astc_void_extent(solid));
    assert_eq!(texels("astc 4x4", &astc), vec![solid; 16]);
}
