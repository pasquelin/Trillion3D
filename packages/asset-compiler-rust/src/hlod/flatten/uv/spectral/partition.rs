//! A chart's partition: made simple, flattened by its spectrum, and cut into children where the
//! flattening cannot hold the stretch.
//!
//! - Preparing (`prepare`): one object, one boundary, the vertices ranked.
//! - Partitioning (`partition`): a single face is laid flat; a plane is projected (`shape`);
//!   otherwise the spectral embedding (`embed`) decides: a plane-like or trivial shape is taken
//!   as embedded, a cylinder or horn is cut by its own rule, any other shape is clustered.
//! - Splitting in two (`split`), when the engine asks for more charts: along the two farthest
//!   landmarks on the surface, else along the two farthest vertices in the plane, else face by
//!   face.
//! - The children of a face labelling (`children`), the labelling smoothed (`smooth`) and made
//!   valid — false edges kept inside one chart, every chart a manifold (`valid`, `vertex`).
use super::mesh::Chart;

mod children;
mod embed;
mod smooth;
mod split;
mod valid;
mod vertex;

pub(crate) use embed::Embedding;

impl<'a> Chart<'a> {
    /// The chart made simple and, when it already is, its vertices ranked.
    pub(crate) fn prepare(&mut self) -> crate::Result<()> {
        let (_, simple) = self.simplify_topology(true)?;
        if simple {
            self.rank_vertices();
        }
        Ok(())
    }

    /// The chart split into children when it holds several objects or (for a partition) several
    /// boundaries; its boundary count, and whether it was simple already.
    pub(crate) fn simplify_topology(
        &mut self,
        for_partition: bool,
    ) -> crate::Result<(usize, bool)> {
        if self.split_objects()? {
            return Ok((0, false));
        }
        if !for_partition {
            return Ok((0, true));
        }
        let boundaries = self.cut_extra_boundaries()?;
        if !self.children.is_empty() {
            return Ok((boundaries, false));
        }
        Ok((boundaries, true))
    }

    /// The chart parameterised, or cut into children that will be.
    pub(crate) fn partition(&mut self) -> crate::Result<()> {
        let (boundaries, simple) = self.simplify_topology(true)?;
        if !simple {
            return Ok(());
        }
        if self.faces.len() == 1 {
            self.parameterize_one_face(false, 0);
            return Ok(());
        }
        if self.process_plane()? {
            return Ok(());
        }
        let outcome = self.partition_embedded(boundaries);
        self.spectrum.clear();
        outcome
    }

    /// The partition once the chart is no plane: by the shape its embedding shows.
    fn partition_embedded(&mut self, boundaries: usize) -> crate::Result<()> {
        let embedding = self.spectral_embedding()?;
        if embedding.like_plane || self.process_trivial(embedding.primary) {
            return Ok(());
        }
        let special = self.process_special(boundaries, &embedding)?;
        if special && !self.children.is_empty() {
            return Ok(());
        }
        self.process_general(boundaries, &embedding)
    }
}
