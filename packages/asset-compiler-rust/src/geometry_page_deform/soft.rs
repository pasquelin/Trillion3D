//! The existing welded simulation IDs carried through cluster localization and vertex dedup.
use super::Deformation;
use crate::physics_cook::declared_soft;
use crate::{CompilerError, Result};
use serde_json::Value;

impl Deformation {
    pub fn soft_source(&mut self, g: &Value, mesh: usize, positions: &[f32]) -> Result<()> {
        let declared = g["nodes"].as_array().and_then(|nodes| {
            (nodes.iter())
                .filter(|node| node["mesh"].as_u64() == Some(mesh as u64))
                .find_map(|node| declared_soft(node).map(|(kind, _)| kind))
        });
        let Some(kind) = declared else {
            return Ok(());
        };
        if self.skin.is_some() || !self.targets.is_empty() {
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
        self.skin = Some((ids, weights));
        self.influences = 4;
        self.soft_source = Some(kind);
        Ok(())
    }
}
