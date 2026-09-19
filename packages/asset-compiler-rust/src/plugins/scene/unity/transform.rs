//! Space conversion, once and for all.
//!
//! Unity: left-handed, Y up, Z forward, one unit = one metre. glTF: right-handed, Y up, Z toward
//! the viewer, one unit = one metre. The two differ only by the sign of Z: the exact conversion
//! is the reflection `S = diag(1, 1, -1)`, which is its own inverse.
//!
//! It is applied only to Unity-scene transforms, never to vertices of an imported model. The
//! reason fits in one line: Unity itself reads an FBX or a glTF by applying `S`, so a model
//! vertex is `S·v` in the Unity scene, and going back to glTF yields
//! `S·(T₁…Tₙ)·S·v = (S·T₁·S)…(S·Tₙ·S)·v`. The chain telescopes: converting each local transform
//! by `T ↦ S·T·S` is enough, and the model's geometry stays intact, in the space its own driver
//! yielded. `S·T·S` is a proper rotation (determinant +1): face winding does not change, no
//! normal is flipped.
//!
//! On a Unity local transform (position `p`, quaternion `q`, scale `s`), that gives:
//! - position `(x, y, -z)` ;
//! - quaternion `(-x, -y, z, w)` — the reflection sends axis `a` to `S·a` and angle `θ` to `-θ` ;
//! - scale unchanged, since `S·diag(s)·S = diag(s)`.
use serde_json::{json, Value};

/// A Unity local transform, already converted into glTF space.
#[derive(Clone, Copy)]
pub(super) struct Trs {
    pub(super) translation: [f64; 3],
    pub(super) rotation: [f64; 4],
    pub(super) scale: [f64; 3],
}

impl Trs {
    pub(super) const IDENTITY: Trs = Trs {
        translation: [0.0, 0.0, 0.0],
        rotation: [0.0, 0.0, 0.0, 1.0],
        scale: [1.0, 1.0, 1.0],
    };
    /// Converts a local transform read from Unity.
    pub(super) fn from_unity(position: [f64; 3], rotation: [f64; 4], scale: [f64; 3]) -> Trs {
        // `-0.0` equals `0.0` but does not write the same: it is brought back to zero so two
        // conversions of the same scene yield the same bytes.
        let flip = |value: f64| if value == 0.0 { 0.0 } else { -value };
        Trs {
            translation: [position[0], position[1], flip(position[2])],
            rotation: [
                flip(rotation[0]),
                flip(rotation[1]),
                rotation[2],
                rotation[3],
            ],
            scale,
        }
    }
    /// A transform with a non-finite number cannot enter the scene: the driver counts it in the
    /// report and leaves identity in its place.
    pub(super) fn is_finite(&self) -> bool {
        let finite = |values: &[f64]| values.iter().all(|value| value.is_finite());
        let length = self.rotation.iter().map(|v| v * v).sum::<f64>();
        finite(&self.translation) && finite(&self.rotation) && finite(&self.scale) && length > 1e-12
    }
    /// Fields of a glTF node, omitted when they equal the format default.
    pub(super) fn write(&self, node: &mut Value) {
        if self.translation != Trs::IDENTITY.translation {
            node["translation"] = json!(self.translation);
        }
        if self.rotation != Trs::IDENTITY.rotation {
            let length = self.rotation.iter().map(|v| v * v).sum::<f64>().sqrt();
            node["rotation"] = json!(self.rotation.map(|value| value / length));
        }
        if self.scale != Trs::IDENTITY.scale {
            node["scale"] = json!(self.scale);
        }
    }
}
