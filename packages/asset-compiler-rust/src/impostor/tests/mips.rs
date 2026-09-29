use crate::impostor::atlas::kinds;
use crate::impostor::bake::{bake, Capture};
use crate::impostor::eligibility::FRAMES;
use crate::texture_preview::tests::coverage_filtered::strays;
use crate::texture_preview::AtlasKind;

// Behaviour: the colour map's mip chain is a coverage chain at the cut, and every level whose
// frames keep four texels a side holds level 0's filtered coverage within the #44 bar (2.5 %,
// or one texel's four samples); the other maps keep the plain data chain. Below four texels a
// frame is a few pixels on screen, and the median of four that the rule scales, not replaces,
// can hold opaque texels no scale cuts.
#[test]
fn the_atlas_mip_chain_holds_level_zero_coverage() {
    let mut atlas = bake(
        &super::tree(),
        Capture {
            frames: FRAMES,
            side: 32,
            hemi: false,
        },
    );
    atlas.dilate();
    let [(_, colour), (_, normal), (_, orm)] = kinds();
    let AtlasKind::Coverage(cutoff) = colour else {
        panic!("the colour map is a coverage chain")
    };
    assert_eq!(cutoff, 128);
    assert_eq!((normal, orm), (AtlasKind::Data, AtlasKind::Data));
    let chain = atlas.chain(0);
    assert_eq!(chain.len(), (FRAMES * 32).ilog2() as usize + 1);
    let sharp = (32usize.ilog2() - 2) as usize;
    assert_eq!(strays(&chain[..=sharp], cutoff), [0usize; 0]);
    // Dilation fills the colour under empty texels, never their coverage.
    let empty = atlas.maps[0]
        .as_chunks::<4>()
        .0
        .iter()
        .filter(|t| t[3] == 0);
    assert!(empty.clone().count() > 0 && empty.clone().all(|t| t[..3] != [0, 0, 0]));
}
