use super::*;
use crate::texture_preview::collect::{atlas_textures, coverage_cutoff, AtlasTexture};
use crate::texture_preview::coverage::{cutoff_byte, Covered};

/// Foliage: a smooth random field cut by a soft edge, four octaves of value noise from 32 texels
/// down to 4, the alpha ramp two texels wide — what a leaf atlas's mask looks like.
fn foliage(side: u32) -> image::RgbaImage {
    let lattice = |x: u32, y: u32, seed: u32| {
        let mut h = x.wrapping_mul(374_761_393) ^ y.wrapping_mul(668_265_263) ^ seed;
        h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
        f32::from((h >> 16) as u16) / 65_535.0
    };
    let octave = |x: u32, y: u32, period: u32, seed: u32| {
        let (cx, cy) = (x / period, y / period);
        let smooth = |t: f32| t * t * (3.0 - 2.0 * t);
        let fx = smooth((x % period) as f32 / period as f32);
        let fy = smooth((y % period) as f32 / period as f32);
        let top = lattice(cx, cy, seed) * (1.0 - fx) + lattice(cx + 1, cy, seed) * fx;
        let bottom = lattice(cx, cy + 1, seed) * (1.0 - fx) + lattice(cx + 1, cy + 1, seed) * fx;
        top * (1.0 - fy) + bottom * fy
    };
    rgba_from(side, side, |x, y| {
        let n = [(32, 0.5), (16, 0.25), (8, 0.15), (4, 0.1)]
            .iter()
            .enumerate()
            .map(|(seed, &(period, weight))| weight * octave(x, y, period, seed as u32))
            .sum::<f32>();
        let alpha = ((n - 0.55) * 8.0 + 0.5).clamp(0.0, 1.0);
        [60, 140, 40, (alpha * 255.0).round() as u8]
    })
}

/// Levels of `chain` whose count of texels at or above `cutoff` strays from level 0's share
/// by more than 2.5 %, or by more than one texel where 2.5 % is less: a level cannot cover a
/// fraction of a texel.
fn strays(chain: &[Vec<u8>], cutoff: u8) -> Vec<usize> {
    let covered = |level: &[u8]| {
        level
            .iter()
            .skip(3)
            .step_by(4)
            .filter(|&&a| a >= cutoff)
            .count()
    };
    let share = covered(&chain[0]) as f64 / (chain[0].len() / 4) as f64;
    (0..chain.len())
        .filter(|&k| {
            let target = share * (chain[k].len() / 4) as f64;
            (covered(&chain[k]) as f64 - target).abs() > (0.025 * target).max(1.0)
        })
        .collect()
}

// #44: a masked chain keeps level 0's coverage at every level, whatever the cutoff; the median
// alone — develop's rule, which a blended-only chain keeps — thins the foliage out from 64 × 64.
#[test]
fn coverage_holds_at_every_level_of_a_masked_chain() {
    let source = foliage(512);
    for cutoff in [64, 128, 191] {
        let chain = reduce::chain(&source, AtlasKind::Coverage(cutoff));
        assert_eq!(
            strays(&chain, cutoff),
            Vec::<usize>::new(),
            "cutoff {cutoff}"
        );
    }
    let median = reduce::chain(&source, AtlasKind::Coverage(0));
    assert_eq!(strays(&median, 128), [3, 4, 5, 6, 7, 8]);
}

// #44, step 4: `a × (C − 0.5) / (t − 0.5)` rounded half up, in integers. Level 0 covers half its
// texels at 128; the level's median alphas cover two of four from `t` = 11 to 90, and 90 is
// nearest the cutoff: `s` = 127.5 / 89.5, so 100 → 142, 90 → 128, 10 → 14, 0 → 0.
#[test]
fn the_scale_lands_on_the_cutoff_in_integers() {
    let texels = |alphas: [u8; 4]| {
        alphas
            .iter()
            .flat_map(|&a| [9, 9, 9, a])
            .collect::<Vec<_>>()
    };
    let covered = Covered::of(&texels([200, 200, 0, 0]), AtlasKind::Coverage(128)).expect("cut");
    let mut level = texels([100, 90, 10, 0]);
    covered.preserve(&mut level);
    assert_eq!(level, texels([142, 128, 14, 0]));
    let mut unchanged = texels([255, 128, 127, 0]);
    covered.preserve(&mut unchanged);
    assert_eq!(
        unchanged,
        texels([255, 128, 127, 0]),
        "t = C keeps the bytes"
    );
    assert!(
        Covered::of(&level, AtlasKind::Coverage(0)).is_none(),
        "blended: median alone"
    );
}

// #44: the cutoff is the lowest among the image's coverage readers, as the smallest byte the
// engine keeps (`alpha >= alphaTest`); 0 — median alone — when every one blends.
#[test]
fn the_chain_is_cut_at_the_lowest_cutoff_of_its_coverage_readers() {
    assert_eq!(
        [0.5, 0.25, 1.0 / 255.0, 1.0, 1.5].map(cutoff_byte),
        [128, 64, 1, 255, 0]
    );
    // One texture read by two masked materials and a blended one takes the lowest cutoff…
    let base = |mode: &str, cutoff: f64| {
        json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
            "alphaMode": mode, "alphaCutoff": cutoff})
    };
    let primitives = [0, 1, 2].map(|m| json!({"attributes": {}, "material": m}));
    let g = json!({
        "materials": [base("MASK", 0.5), base("MASK", 0.25), base("BLEND", 0.9)],
        "meshes": [{"primitives": primitives}],
    });
    let found = atlas_textures(&g, &BTreeSet::from([0])).expect("collect");
    assert_eq!(found[0].kind, AtlasKind::Coverage(64));
    // …and so does an image read by several textures; a blended-only one is not cut.
    let reader = |kind| AtlasTexture {
        kind,
        ..found[0].clone()
    };
    let image = [128, 64, 0].map(|cutoff| reader(AtlasKind::Coverage(cutoff)));
    assert_eq!(coverage_cutoff(&image), 64);
    assert_eq!(coverage_cutoff(&[reader(AtlasKind::Coverage(0))]), 0);
}

// #44: each cutoff names its own files and sidecar word, so two scenes cutting one image at two
// cutoffs never serve each other's levels, and a blended-only chain keeps develop's name.
#[test]
fn each_cutoff_names_its_own_chain() {
    let dir = temp_dir("bake-cutoffs");
    foliage(256).save(dir.join("map.png")).expect("save");
    let material = |mode: &str, cutoff: f64| {
        gate::scene(
            json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
            "alphaMode": mode, "alphaCutoff": cutoff}),
        )
    };
    let kinds = [("MASK", 0.5), ("MASK", 0.25), ("BLEND", 0.5)]
        .map(|(mode, cutoff)| stage_scene(&dir, &material(mode, cutoff)).0[0].kind);
    let expected = [128, 64, 0].map(AtlasKind::Coverage);
    assert_eq!(kinds, expected);
    let names = kinds.map(|kind| (kind.name(), kind.word()));
    let expected = [
        ("srgb-coverage-128", (128 << 8) | 2),
        ("srgb-coverage-64", (64 << 8) | 2),
        ("srgb-coverage", 2),
    ];
    assert_eq!(names, expected.map(|(name, word)| (name.into(), word)));
    for kind in kinds {
        assert_eq!(AtlasKind::from_word(kind.word()), Some(kind));
    }
    assert_eq!(
        AtlasKind::from_word(128 << 8),
        None,
        "only coverage carries a cutoff"
    );
}
