use crate::impostor::atlas::kinds;
use crate::impostor::bake::{bake, Capture};
use crate::impostor::eligibility::FRAMES;
use crate::texture_preview::tests::coverage_filtered::strays;
use crate::texture_preview::AtlasKind;

// Behaviour: the colour map's mip chain is a coverage chain at the cut, and every level it
// stores — down to frames of four texels a side (`FRAME_FLOOR`) — holds level 0's filtered
// coverage within 2.5 % (or one texel's four samples); the other maps keep the
// plain data chain.
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
    // 32, 16, 8 and 4 texels a frame: the chain stops where a frame keeps four.
    assert_eq!(chain.len(), 4);
    assert_eq!(strays(&chain, cutoff), [0usize; 0]);
    // Dilation fills the colour under empty texels, never their coverage.
    let empty = atlas.maps[0]
        .as_chunks::<4>()
        .0
        .iter()
        .filter(|t| t[3] == 0);
    assert!(empty.clone().count() > 0 && empty.clone().all(|t| t[..3] != [0, 0, 0]));
}
