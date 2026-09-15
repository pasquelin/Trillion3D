//! Les lampes d'une scène lue par ufbx : la matrice d'un nœud, et la lampe ponctuelle glTF qu'il
//! porte. Le pilote ne place jamais de lampe de lui-même — tout vient des données importées.
use super::*;

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
    let d = crate::shared_math::normalized_or(
        [direction.x, direction.y, direction.z],
        [0.0, 0.0, -1.0],
    );
    let z = [-d[0], -d[1], -d[2]];
    let up = if z[1].abs() > 0.99 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let x = [
        up[1] * z[2] - up[2] * z[1],
        up[2] * z[0] - up[0] * z[2],
        up[0] * z[1] - up[1] * z[0],
    ];
    let xl = (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]).sqrt();
    let x = [x[0] / xl, x[1] / xl, x[2] / xl];
    let y = [
        z[1] * x[2] - z[2] * x[1],
        z[2] * x[0] - z[0] * x[2],
        z[0] * x[1] - z[1] * x[0],
    ];
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
        // FBX ne porte pas d'unité photométrique : son intensité est un pourcentage, que le réglage
        // publié de `compiler_lights` rend en candela ou en lux, comme le glTF.
        let intensity = light.intensity * crate::compiler_lights::fbx_intensity_scale(kind);
        let mut json = json!({"name":&*light.element.name,"type":kind,"color":[light.color.x,light.color.y,light.color.z],"intensity":intensity,"extras":{"castsShadow":light.cast_shadows}});
        if kind == "spot" {
            json["spot"] = json!({"innerConeAngle":light.inner_angle.to_radians(),"outerConeAngle":light.outer_angle.to_radians().max(0.001)});
        }
        self.lights.push(json);
        self.nodes.push(json!({"name":&*node.element.name,"matrix":matrix,"extensions":{"KHR_lights_punctual":{"light":self.lights.len()-1}}}));
    }
}
