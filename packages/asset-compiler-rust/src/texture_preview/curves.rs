//! Les deux courbes de la chaîne d'aperçus : celle qui ramène un octet reçu en linéaire, et celle
//! qui rend un linéaire en octet sRGB. Elles sont séparées de la réduction parce qu'elles ne
//! dépendent que de ce que le fichier a déclaré, jamais de la géométrie des niveaux.
use super::Transfer;

/// La table qui ramène un octet reçu en linéaire, selon ce que le fichier a déclaré. Des
/// échantillons déjà proportionnels à la lumière ne passent par aucune courbe : leur table est la
/// division par 255, et rien d'autre. L'aperçu, lui, reste du sRGB dans les deux cas — c'est son
/// contrat —, si bien qu'une source linéaire y est **encodée** au dernier pas au lieu d'être
/// décodée deux fois.
pub(super) fn transfer_table(transfer: Transfer) -> &'static [f32; 256] {
    match transfer {
        Transfer::Srgb => srgb_table(),
        Transfer::Linear => linear_table(),
    }
}

/// Les 256 valeurs d'octet linéaire, à leur échelle : la table neutre.
pub(super) fn linear_table() -> &'static [f32; 256] {
    static TABLE: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0f32; 256];
        for (value, slot) in table.iter_mut().enumerate() {
            *slot = value as f32 / 255.0;
        }
        table
    })
}

/// Les 256 valeurs d'octet sRGB en linéaire, construites une fois pour toute la compilation.
///
/// La même courbe qu'`albedo.rs::srgb_to_linear`, mais en `f32` : 214 des 256 entrées diffèrent de
/// la version `f64` arrondie, et la moyenne de boîte s'accumule en `f32` puis en `f64`. Remplacer
/// la table par un appel changerait les octets de l'aperçu ; les deux exemplaires restent.
pub(super) fn srgb_table() -> &'static [f32; 256] {
    static TABLE: std::sync::OnceLock<[f32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0f32; 256];
        for (value, slot) in table.iter_mut().enumerate() {
            let encoded = value as f32 / 255.0;
            *slot = if encoded <= 0.04045 {
                encoded / 12.92
            } else {
                ((encoded + 0.055) / 1.055).powf(2.4)
            };
        }
        table
    })
}

pub(super) fn linear_to_srgb(value: f32) -> u8 {
    let encoded = if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    (encoded.clamp(0.0, 1.0) * 255.0).round() as u8
}
