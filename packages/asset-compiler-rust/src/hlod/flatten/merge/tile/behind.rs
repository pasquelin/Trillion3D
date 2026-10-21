//! What lies behind a merged mesh's translucent texels (`Behind`): every part of the merged mesh
//! traced in world space wearing its material, and the tree over them, which the ray from a
//! translucent texel's point inward along its vertex normal walks, front to back until an opaque
//! surface (`tile.rs`, `bake::seen`).
use super::shade::look;
use super::Steps;
use crate::hlod::flatten::bake::seen::{Layer, Layers};
use crate::hlod::flatten::bake::sources::{Library, Piece, Sources};
use crate::hlod::flatten::bake::tree::Tree;
use crate::hlod::flatten::bake::Maps;
use crate::trace::surface::mesh::Footprint;
use crate::trace::tracer::normal_of;
use trillion3d_math::vector::vecn::dot;

/// What lies behind a merged mesh's translucent texels (module doc): every part of the merged
/// mesh traced in world space wearing its material, and the tree over them.
pub(in crate::hlod) struct Behind {
    sources: Sources,
    tree: Tree,
}

impl Behind {
    /// What lies behind any texel of `pieces`, the merged mesh's parts, each wearing its material
    /// of `library`.
    pub(in crate::hlod) fn of(pieces: &[Piece], library: &Library) -> Self {
        let sources = Sources::of(pieces, library);
        let tree = Tree::from_soup(sources.mesh.world.triangles.clone());
        Self { sources, tree }
    }

    /// Whether a ray along `ray`, its footprint `footprint`, stops at triangle `t` at `at`: a
    /// surface met on a face it draws — its front, or its back where it draws both faces — and
    /// not cut away there; a translucent one is a layer, met as any other.
    fn stops(&self, t: usize, at: [f64; 2], (ray, footprint): ([f64; 3], Footprint)) -> bool {
        let traced = &self.sources.mesh;
        let front = dot(normal_of(&traced.world, t), ray) < 0.0;
        let both = self.sources.double_sided[traced.world.tags[t] as usize];
        let surface = traced.surface(t);
        (front || both)
            && (surface.cut.is_none() || {
                let steps = traced.steps(t, (ray, footprint));
                let (uv, across) = traced.uv(t, at, 0, steps);
                surface.keeps(uv, across, traced.vertex_colour(t, at)[3])
            })
    }

    /// `front`, a translucent texel's own layer at `origin` on its surface, laid over what lies
    /// behind it along `ray`, `footprint` the texel's sides there: each surface the ray stops at
    /// past the one before by more than a tie (`Traceable::tie`), read as `maps` bakes it over the
    /// footprint carried along the ray onto it (`look`), composed front to back (`seen::Layers`);
    /// the base colour and the roughness and metallic they make.
    pub(super) fn seen(
        &self,
        front: Layer,
        (origin, ray): ([f64; 3], [f64; 3]),
        footprint: Footprint,
        maps: Maps,
    ) -> ([f64; 3], [f64; 2]) {
        let traced = &self.sources.mesh;
        let gap = traced.tie();
        let stops = |slot: usize, at| self.stops(self.tree.rank(slot), at, (ray, footprint));
        let mut layers = Layers::default();
        let mut more = layers.add(front);
        let mut past = gap;
        while more {
            let found = self
                .tree
                .first((origin, ray), (past, f64::INFINITY), &stops);
            let Some((slot, distance, at)) = found else {
                break;
            };
            let t = self.tree.rank(slot);
            let steps: Steps = traced.steps(t, (ray, footprint));
            more = layers.add(look(&self.sources, (t, at, steps), maps));
            past = distance + gap;
        }
        layers.value()
    }
}
