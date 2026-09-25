use super::*;

// Behaviour 5: in the colour atlas, the colour of the next level is the mean of the four
// texels weighted by their alpha (#42). A transparent texel is no colour: its RGB — often
// black — used to enter the mean and dark borders grew around alpha-masked foliage at the
// coarse levels. Alpha itself stays the median of the four.
#[test]
fn an_opaque_colour_beside_transparent_black_is_not_darkened() {
    let cases: [([u8; 4], u8); 2] = [([255, 0, 0, 0], 0), ([255, 255, 0, 0], 128)];
    for (alphas, median) in cases {
        let source = rgba_from(2, 2, |x, y| {
            let alpha = alphas[(y * 2 + x) as usize];
            if alpha == 0 {
                [0, 0, 0, 0]
            } else {
                [200, 90, 30, alpha]
            }
        });
        let chain = reduce::chain(&source, AtlasKind::Color);
        assert_eq!(chain[1], vec![200, 90, 30, median], "alphas {alphas:?}");
    }
}

// Behaviour 5 (b): a partly transparent texel counts for its alpha — one opaque white and one
// half-transparent black in linear light give white weighted 1 and black weighted 0.5, so two
// thirds of white, then the sRGB curve: 213.
#[test]
fn a_partly_transparent_texel_counts_for_its_alpha() {
    let source = rgba_from(2, 1, |x, _| {
        if x == 0 {
            [255, 255, 255, 255]
        } else {
            [0, 0, 0, 128]
        }
    });
    let chain = reduce::chain(&source, AtlasKind::Color);
    assert_eq!(&chain[1][..3], &[213, 213, 213]);
}

/// Every level of a chain, hashed: the digests below were taken on the plain mean the rule
/// replaced, before #42.
fn digest(source: &image::RgbaImage, kind: AtlasKind) -> String {
    hash(&reduce::chain(source, kind).concat())
}

/// A texture with no two neighbours alike and an odd side, so every branch of the reduction runs.
fn noisy(alpha: impl Fn(u32, u32) -> u8) -> image::RgbaImage {
    rgba_from(13, 7, |x, y| {
        let n = x * 97 + y * 61;
        [
            (n % 256) as u8,
            (n * 7 % 256) as u8,
            (n * 13 % 251) as u8,
            alpha(x, y),
        ]
    })
}

// Behaviour 5 (c): what has no varying alpha is byte-identical to the plain mean — a fully
// opaque texture, one of uniform alpha, one fully transparent — and so is every texture of the
// data atlas, whose alpha is not coverage (a packed channel, a height): its colours keep the
// plain mean whatever alpha says.
#[test]
fn opaque_uniform_and_data_chains_keep_the_plain_mean_byte_for_byte() {
    let varied = |x: u32, y: u32| ((x * 41 + y * 23) % 256) as u8;
    let cases = [
        (noisy(|_, _| 255), AtlasKind::Color),
        (noisy(|_, _| 128), AtlasKind::Color),
        (noisy(|_, _| 0), AtlasKind::Color),
        (noisy(varied), AtlasKind::Data),
    ];
    let digests: Vec<String> = cases.iter().map(|(s, k)| digest(s, *k)).collect();
    assert_eq!(
        digests,
        [
            "c87c2f7337162b5b3cb272deedfb87d5b8eaa89b58cc648599ac18a3a856dde7",
            "b32e7fde0ddebd03ac87dba0d453465f92a0367fc880749299f7cf41d50b0139",
            "97bfdc6d57021ef7ad015deaf7e03d6651b426ebea61d121dae04276e8cd32e0",
            "26a7edaa6659a0955b6f6205f3fe636a446ee3b1e438188001230f6e2a456efe",
        ]
    );
}
