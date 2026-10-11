//! The existing welded simulation IDs carried through cluster localization and vertex dedup.
use crate::physics_cook::declared_soft;
use crate::{CompilerError, Result};
use serde_json::Value;
use trillion3d_page_codec::encode::deformation::Deformation;

/// A primitive a node declares a soft body: each drawn vertex carries, in the skin stream at
/// weight one, the simulated vertex it follows (positions welded and compacted as the cook's
/// `soft_record.rs` does), so the page writes the simulation back into the drawn mesh. A
/// primitive that also carries a skin or morph targets is refused (`SOFT_DEFORMATION`) rather
/// than giving one stream two meanings.
pub fn declare_soft(d: &mut Deformation, g: &Value, mesh: usize, positions: &[f32]) -> Result<()> {
    let declared = g["nodes"].as_array().and_then(|nodes| {
        (nodes.iter())
            .filter(|node| node["mesh"].as_u64() == Some(mesh as u64))
            .find_map(|node| declared_soft(node).map(|(kind, _)| kind))
    });
    let Some(kind) = declared else {
        return Ok(());
    };
    if d.skin.is_some() || !d.targets.is_empty() {
        return Err(CompilerError::new(
            "SOFT_DEFORMATION",
            "A simulated primitive cannot also carry a skin or morph targets",
        ));
    }
    let every: Vec<u32> = (0..positions.len() as u32 / 3).collect();
    let welded = crate::dag::clusters::weld_positions(positions, &every);
    let (_, map, _) = crate::qem::compact_region(positions, &welded);
    if map.iter().any(|&v| v > 0xffff) {
        return Err(CompilerError::new(
            "SOFT_DEFORMATION",
            "A simulated primitive names more than 65,536 simulation vertices",
        ));
    }
    let ids = map.iter().flat_map(|&v| [v; 4]).collect();
    let weights = map.iter().flat_map(|_| [1.0, 0.0, 0.0, 0.0]).collect();
    d.skin = Some((ids, weights));
    d.influences = 4;
    d.soft_source = Some(kind);
    Ok(())
}
