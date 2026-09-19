use super::*;

/// Opacity of a material, whichever map family carries it. ufbx fills
/// `pbr.opacity` only for shaders that declare an opacity (Blender, OBJ, Arnold,
/// glTF…); a classic FBX material — Phong, Lambert — stores its own in
/// `fbx.transparency_*`, where `TransparentColor` carries the transparency *and*
/// its texture. Reading only the PBR map would silently emit a transparent
/// material as opaque.
pub(super) struct Opacity<'m> {
    /// Scalar factor applied to the base-colour alpha; 1.0 = opaque.
    pub(super) alpha: f64,
    /// The map that carries the opacity map, when the file declares an active one.
    pub(super) texture: Option<&'m ufbx::MaterialMap>,
}

/// Classic FBX convention: `TransparentColor` is a *transparency* weighted by
/// `TransparencyFactor`. Black, or a zero factor, is opaque; white and a full
/// factor, invisible.
pub(crate) fn opacity_from_transparency(color: [f64; 3], factor: f64) -> f64 {
    let transparency = (color[0] + color[1] + color[2]) / 3.0 * factor;
    (1.0 - transparency).clamp(0.0, 1.0)
}

/// A map counts as declared as soon as it carries a value **or** a texture: a
/// property with no value but a bound map is the common opacity-export case.
fn declared(map: &ufbx::MaterialMap) -> bool {
    map.has_value || map.texture.is_some()
}

/// The map bound to a map, if the file has not disabled it — a texture the source
/// turns off stays off.
fn bound(map: &ufbx::MaterialMap) -> Option<&ufbx::MaterialMap> {
    (map.texture.is_some() && map.texture_enabled).then_some(map)
}

pub(super) fn read_opacity(material: &ufbx::Material) -> Opacity<'_> {
    let pbr_opacity = &material.pbr.opacity;
    if declared(pbr_opacity) {
        return Opacity {
            alpha: map_value(pbr_opacity, 1.0).clamp(0.0, 1.0),
            texture: bound(pbr_opacity),
        };
    }
    let (color, factor) = (
        &material.fbx.transparency_color,
        &material.fbx.transparency_factor,
    );
    if !declared(color) && !declared(factor) {
        return Opacity {
            alpha: 1.0,
            texture: None,
        };
    }
    let c = color.value_vec4;
    Opacity {
        alpha: opacity_from_transparency([c.x, c.y, c.z], map_value(factor, 1.0)),
        texture: bound(color).or_else(|| bound(factor)),
    }
}
