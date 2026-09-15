use super::*;

/// L'opacité d'un matériau, quelle que soit la famille de maps qui la porte. ufbx ne remplit
/// `pbr.opacity` que pour les shaders qui déclarent une opacité (Blender, OBJ, Arnold, glTF…) ;
/// un matériau FBX classique — Phong, Lambert — range la sienne dans `fbx.transparency_*`, où
/// `TransparentColor` porte la transparence *et* sa texture. Lire la seule map PBR fait sortir
/// opaque un matériau transparent, en silence.
pub(super) struct Opacity<'m> {
    /// Facteur scalaire appliqué à l'alpha de la couleur de base ; 1.0 = opaque.
    pub(super) alpha: f64,
    /// La map qui porte la carte d'opacité, quand le fichier en déclare une d'active.
    pub(super) texture: Option<&'m ufbx::MaterialMap>,
}

/// Convention FBX classique : `TransparentColor` est une *transparence* pondérée par
/// `TransparencyFactor`. Noir, ou facteur nul, vaut opaque ; blanc et facteur plein, invisible.
pub(crate) fn opacity_from_transparency(color: [f64; 3], factor: f64) -> f64 {
    let transparency = (color[0] + color[1] + color[2]) / 3.0 * factor;
    (1.0 - transparency).clamp(0.0, 1.0)
}

/// Une map compte comme déclarée dès qu'elle porte une valeur **ou** une texture : une propriété
/// sans valeur mais avec une carte liée est le cas courant des exports d'opacité.
fn declared(map: &ufbx::MaterialMap) -> bool {
    map.has_value || map.texture.is_some()
}

/// La carte liée à une map, si le fichier ne l'a pas désactivée — une texture que la source
/// éteint reste éteinte.
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
