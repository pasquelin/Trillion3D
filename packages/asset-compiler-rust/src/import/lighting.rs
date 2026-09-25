//! Lights of a scene read by ufbx: a node's matrix, and the glTF punctual light
//! it carries. The driver never places a light of its own — everything comes from
//! imported data.
use super::*;
use crate::shared_math::{cross, divide, length, normalized_or};

pub(super) fn matrix_json(m: &ufbx::Matrix) -> Vec<f64> {
    vec![
        m.m00, m.m10, m.m20, 0.0, m.m01, m.m11, m.m21, 0.0, m.m02, m.m12, m.m22, 0.0, m.m03, m.m13,
        m.m23, 1.0,
    ]
}
pub(super) fn matrix_is_finite(m: &[f64]) -> bool {
    m.iter().all(|v| v.is_finite())
}
/// Rotates the glTF light axis (-Z) onto the FBX light direction, then applies the node transform.
pub(super) fn light_matrix(node: &ufbx::Node, direction: ufbx::Vec3) -> Vec<f64> {
    let d = normalized_or([direction.x, direction.y, direction.z], [0.0, 0.0, -1.0]);
    let z = [-d[0], -d[1], -d[2]];
    let up = if z[1].abs() > 0.99 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let x = cross(up, z);
    let x = divide(x, length(x));
    let y = cross(z, x);
    let n = &node.node_to_world;
    let mul = |c: [f64; 3]| {
        [
            n.m00 * c[0] + n.m01 * c[1] + n.m02 * c[2],
            n.m10 * c[0] + n.m11 * c[1] + n.m12 * c[2],
            n.m20 * c[0] + n.m21 * c[1] + n.m22 * c[2],
        ]
    };
    let (cx, cy, cz) = (mul(x), mul(y), mul(z));
    vec![
        cx[0], cx[1], cx[2], 0.0, cy[0], cy[1], cy[2], 0.0, cz[0], cz[1], cz[2], 0.0, n.m03, n.m13,
        n.m23, 1.0,
    ]
}

impl Importer<'_> {
    pub(super) fn push_light(&mut self, node: &ufbx::Node, light: &ufbx::Light) {
        let kind = match light.type_ {
            ufbx::LightType::Point => "point",
            ufbx::LightType::Directional => "directional",
            ufbx::LightType::Spot => "spot",
            _ => {
                self.report.add("light-area-or-volume");
                return;
            }
        };
        let matrix = light_matrix(node, light.local_direction);
        if !matrix_is_finite(&matrix) {
            self.report.add("node-invalid-transform");
            return;
        }
        // FBX carries no photometric unit: its intensity is a percentage, which the
        // published `compiler_lights` setting turns into candela or lux, like glTF.
        // And FBX declares no emitter radius: the compiler then measures it on the
        // light's emissive body.
        let source = crate::import::LightSource {
            name: light.element.name.to_string(),
            kind,
            colour: [light.color.x, light.color.y, light.color.z],
            intensity: light.intensity * crate::compiler_lights::fbx_intensity_scale(kind),
            cone: (kind == "spot").then(|| {
                (
                    light.inner_angle.to_radians(),
                    light.outer_angle.to_radians().max(0.001),
                )
            }),
            casts_shadow: Some(light.cast_shadows),
            emitter_radius: None,
        };
        self.lights.push(source.json());
        self.nodes.push(crate::import::light_node(
            &node.element.name,
            json!(matrix),
            self.lights.len() - 1,
        ));
    }
}
