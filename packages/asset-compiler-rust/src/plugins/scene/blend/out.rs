//! The glTF tables this driver fills — every driver's `SceneTables` — and the RAM budget the
//! scene binary keeps under.
//!
//! The driver reads raw geometry — vertices, corners, faces — and therefore has no accessor to
//! copy: it creates them. Each array goes into the binary through an aligned view, and the
//! accessor that names it carries the bounds glTF requires of positions.
use super::*;
use crate::plugins::scene::convert::SceneTables;

/// The intermediate scene under construction.
#[derive(Default)]
pub(super) struct Out {
    pub(super) scene: SceneTables,
    /// The bytes the scene binary may reach: the job's RAM budget, less what the open file holds.
    pub(super) room: usize,
}

impl Out {
    /// Refuses the scene, naming the `kind` and `name` that adds them, when `adding` bytes more
    /// take the binary, which held `held`, past its room.
    pub(super) fn fit(&self, kind: &str, name: &str, held: usize, adding: usize) -> Result<()> {
        if held.saturating_add(adding) > self.room {
            return Err(refused(
                "blend-too-large",
                format!("blend: {kind} {name} needs {adding} bytes, and the scene binary already holds {held} of the {} bytes this job's RAM budget (ramBudgetMb) leaves it once the file is open", self.room),
            ));
        }
        Ok(())
    }
}
