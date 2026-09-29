use crate::impostor::eligibility::{Candidate, FRAMES};
use crate::impostor::stage::entry;
use crate::texture_preview::tests::{options, temp_dir};

// Behaviour: a mesh whose root stays below the pixels it covers out to the scene's reach is
// refused, with the reason and its numbers in its report entry; the same tree placed many times
// with a root heavier than its pixels is baked, its maps and levels in the entry; a single
// opaque placement is refused before the mesh is read.
#[test]
fn a_mesh_whose_root_is_cheaper_than_its_pixels_is_refused_with_its_reason() {
    let o = options(&temp_dir("impostor-refusal"));
    let candidate = |root_triangles| Candidate {
        root_triangles,
        radius: 0.0,
        placements: 40,
        masked: true,
        skinned: false,
        reach: 200.0,
    };
    let tree = || Ok((super::tree(), 1.0, false));
    let refused = entry(&o, candidate(124), tree).expect("entry");
    assert_eq!(refused["status"], "refused");
    assert_eq!(refused["reason"], "root-cheaper-than-impostor");
    let detail = refused["detail"].as_str().expect("detail");
    assert!(
        detail.contains("124 root triangles") && detail.contains("200.0 m"),
        "{detail}"
    );
    assert!(refused["coverage"].as_f64().expect("measured coverage") > 0.0);
    let baked = entry(&o, candidate(800), tree).expect("entry");
    assert_eq!(baked["status"], "baked", "{baked}");
    assert_eq!(
        (baked["frames"].as_u64(), baked["frameSide"].as_u64()),
        (Some(FRAMES as u64), Some(64))
    );
    let levels = baked["maps"]["colourCoverage"]["levels"]
        .as_array()
        .expect("levels");
    assert_eq!(levels[0]["width"], FRAMES * 64);
    let depth = |kind: &str| baked["switchDepth"][kind].as_f64().expect("depth");
    assert!(depth("texel") <= depth("triangles"));
    let single = Candidate {
        placements: 1,
        masked: false,
        ..candidate(800)
    };
    let unread = || -> crate::Result<crate::impostor::stage::Loaded> { panic!("read") };
    assert_eq!(
        entry(&o, single, unread).expect("entry")["reason"],
        "single-opaque-placement"
    );
}
