//! The alpha analysis of a baked image is skipped when the cutout cache holds its shape.
use super::*;

// A texture to measure whose image the cutout cache already holds takes the stored shape: the
// alpha analysis is skipped. A shape no image could yield proves it came from the cache; with an
// empty cache the same image is measured.
#[test]
fn a_cached_alpha_shape_skips_the_analysis_and_a_miss_measures_the_image() {
    let dir = temp_dir("bake-cached-shape");
    let source = rgba_from(8, 8, |x, _| [40, 90, 160, if x < 3 { 0 } else { 255 }]);
    source.save(dir.join("leaf.png")).expect("save");
    let sha = hash(&fs::read(dir.join("leaf.png")).expect("read"));
    let stored = crate::cutout::AlphaShape {
        texels: 64,
        absent: 0.125,
        present: 0.125,
        between: 0.75,
        at_contour: 0.5,
    };
    let bits = |s: &crate::cutout::AlphaShape| {
        [s.absent, s.present, s.between, s.at_contour].map(f32::to_bits)
    };
    let o = options(&dir);
    let g = json!({
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
        "meshes": [{"primitives": [{"attributes": {}, "material": 0}]}],
        "textures": [{"source": 0}],
        "images": [{"uri": "leaf.png"}],
    });
    let (meshes, view_map, to_measure) = (
        BTreeSet::from([0usize]),
        BTreeMap::new(),
        BTreeSet::from([0usize]),
    );
    let shape_with = |measurements: &crate::cutout::MeasureCache| {
        let inputs = PreviewInputs {
            o: &o,
            g: &g,
            bin: &[],
            image_root: &dir,
            meshes: &meshes,
            view_map: &view_map,
            to_measure: &to_measure,
            measurements,
        };
        let (_, shapes, _) = stage_texture_previews(&inputs, &silent).expect("stage");
        bits(&shapes[&0])
    };
    let hit = crate::cutout::MeasureCache::holding(&sha, stored.clone());
    assert_eq!(
        shape_with(&hit),
        bits(&stored),
        "a hit must not analyse alpha"
    );
    let measured = bits(&crate::cutout::measure(&source));
    assert_ne!(measured, bits(&stored));
    assert_eq!(shape_with(crate::cutout::MeasureCache::EMPTY), measured);
}
