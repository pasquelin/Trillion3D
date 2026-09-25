use super::*;

// Behaviour 5: in a `Coverage` chain — a colour texture every reader of which takes its alpha
// for coverage —, the colour of the next level is the mean of the four texels weighted by their
// alpha (#42). A transparent texel is no colour: its RGB — often black — used to enter the mean
// and dark borders grew around alpha-masked foliage at the coarse levels. Alpha itself stays the
// median of the four.
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
        let chain = reduce::chain(&source, AtlasKind::Coverage);
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
    let chain = reduce::chain(&source, AtlasKind::Coverage);
    assert_eq!(&chain[1][..3], &[213, 213, 213]);
}

/// Every level of a chain, hashed: the digests below were taken on develop, before #42.
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

/// A cutout: one texel in three transparent over a colour that is still there.
fn cutout(x: u32, y: u32) -> u8 {
    if (x + 2 * y).is_multiple_of(3) {
        0
    } else {
        255
    }
}

// Behaviour 5 (c): no texture a reader draws opaque changes by a byte (hard rule 1). The
// plain colour chain — an opaque base colour, an emissive, readers that disagree — keeps the RGB
// under alpha 0 exactly as develop reduced it, since those readers draw it; so does the data
// atlas, whose alpha is a packed channel or a height. A `Coverage` chain whose alpha does not vary
// — opaque, uniform, fully transparent — is byte-identical to the plain one as well. Only a
// `Coverage` chain whose alpha varies moves.
#[test]
fn every_chain_but_a_varying_coverage_one_keeps_the_develop_bytes() {
    let varied = |x: u32, y: u32| ((x * 41 + y * 23) % 256) as u8;
    let cases = [
        (noisy(cutout), AtlasKind::Color),
        (noisy(varied), AtlasKind::Data),
        (noisy(|_, _| 255), AtlasKind::Coverage),
        (noisy(|_, _| 128), AtlasKind::Coverage),
        (noisy(|_, _| 0), AtlasKind::Coverage),
    ];
    let digests: Vec<String> = cases.iter().map(|(s, k)| digest(s, *k)).collect();
    assert_eq!(
        digests,
        [
            "3742df082210dfb448596bf39b8279deb182a2a2f404144520059cb54d9aa0d6",
            "26a7edaa6659a0955b6f6205f3fe636a446ee3b1e438188001230f6e2a456efe",
            "c87c2f7337162b5b3cb272deedfb87d5b8eaa89b58cc648599ac18a3a856dde7",
            "b32e7fde0ddebd03ac87dba0d453465f92a0367fc880749299f7cf41d50b0139",
            "97bfdc6d57021ef7ad015deaf7e03d6651b426ebea61d121dae04276e8cd32e0",
        ]
    );
    assert_ne!(
        digest(&noisy(cutout), AtlasKind::Coverage),
        digests[0],
        "the same cutout read as coverage is weighted"
    );
}

// Behaviour 5 (d): one image cooked plain in a scene — an opaque base colour — and weighted
// in another — a masked one — into the same cache never shares a file: the chain names its
// files and its sidecar word, so neither scene's levels serve the other.
#[test]
fn a_plain_and_a_coverage_chain_of_one_image_never_share_files() {
    let dir = temp_dir("bake-coverage");
    // Foliage: every 2×2 block half leaf, half transparent black — what weighting changes.
    let source = rgba_from(256, 256, |_, y| {
        if y.is_multiple_of(2) {
            [60, 140, 40, 255]
        } else {
            [0, 0, 0, 0]
        }
    });
    source.save(dir.join("leaf.png")).expect("save");
    let scene = |mode: &str| {
        json!({
            "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "alphaMode": mode}],
            "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
            "textures": [{"source": 0}],
            "images": [{"uri": "leaf.png"}],
        })
    };
    let (plain, _) = stage_scene(&dir, &scene("OPAQUE"));
    let (weighted, _) = stage_scene(&dir, &scene("MASK"));
    assert_eq!(plain[0].sha256, weighted[0].sha256, "one image");
    let kinds = [plain[0].kind, weighted[0].kind];
    assert_eq!(kinds, [AtlasKind::Color, AtlasKind::Coverage]);
    assert_ne!(kinds[0].word(), kinds[1].word());
    let native = dir.join("cache").join("native");
    let levels = kinds.map(|kind| {
        let path = native.join(level_path(&plain[0].sha256, kind, 1, LOSSLESS));
        let decoded = image::open(&path).expect("readable png").to_rgba8();
        assert_eq!(
            decoded.as_raw(),
            &reduce::chain(&source, kind)[1],
            "{kind:?}"
        );
        decoded
    });
    assert_ne!(levels[0], levels[1], "each scene reads its own level");
}
