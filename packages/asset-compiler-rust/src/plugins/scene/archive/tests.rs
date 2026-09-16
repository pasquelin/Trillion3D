//! Ce que les conteneurs refusent, et ce qu'ils laissent derrière eux quand ils refusent.
//!
//! Les archives piégées sont construites ici même, octet par octet : une archive qui met un lecteur
//! à l'épreuve ne doit pas venir de ce lecteur. Rien n'est écrit hors du dossier jetable du cas.
use super::*;
use std::fs;

mod paquet;
mod zip;

/// Un dossier jetable, nommé par le cas qui l'utilise.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-conteneur-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("horloge")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("dossier de test");
    dir
}

/// Ce qu'un conteneur a fait des octets qu'on lui a donnés.
struct Outcome {
    /// Le dossier jetable : la source et le cache y vivent.
    dir: PathBuf,
    /// Le code du refus, ou `accepté` quand le conteneur a produit une scène.
    code: String,
    /// Ce que le conteneur a publié en chemin, dont la chaîne des pilotes.
    reports: Vec<Value>,
}

/// Fait lire ces octets à ce conteneur, dans un dossier jetable à lui seul.
fn outcome(tag: &str, plugin: &dyn ScenePlugin, name: &str, bytes: &[u8]) -> Outcome {
    let dir = scratch(tag);
    let source = dir.join(name);
    fs::write(&source, bytes).expect("archive de test");
    let cache = dir.join("cache");
    let inputs = [source.clone()];
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    let reports = std::sync::Mutex::new(Vec::new());
    let code = match plugin.prepare(&SceneRequest {
        source: &source,
        inputs: &inputs,
        cache: &cache,
        cancelled: &cancelled,
        progress: &|report| reports.lock().expect("rapports").push(report),
    }) {
        Ok(_) => "accepté".to_string(),
        Err(error) => error.code.to_string(),
    };
    Outcome {
        dir,
        code,
        reports: reports.into_inner().expect("rapports"),
    }
}

/// Le dossier extrait qu'un conteneur laisse visible sous ce cache, s'il y en a un. Une extraction
/// refusée n'en laisse aucun : le routeur ne doit jamais voir un chantier comme une scène.
fn extracted(dir: &Path) -> Vec<PathBuf> {
    let archives = dir.join("cache").join("native").join("archives");
    let Ok(entries) = fs::read_dir(&archives) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path().join("content"))
        .filter(|content| content.exists())
        .collect()
}

/// Le paquet ou l'archive une fois le cas fini.
fn cleanup(dir: PathBuf) {
    fs::remove_dir_all(&dir).expect("nettoyage");
}

/// Une entrée d'une archive ZIP écrite ici même.
struct Entry<'a> {
    name: &'a str,
    /// Les octets tels qu'ils entrent dans l'archive.
    data: &'a [u8],
    /// La méthode déclarée : zéro stockée, huit `deflate`.
    method: u16,
    /// La taille décompressée annoncée, qui n'est celle des octets que pour une entrée stockée.
    size: u32,
}

impl<'a> Entry<'a> {
    /// Une entrée stockée telle quelle, la seule que la disposition USDZ admette.
    fn stored(name: &'a str, data: &'a [u8]) -> Entry<'a> {
        Entry {
            name,
            data,
            method: 0,
            size: data.len() as u32,
        }
    }
}

/// Une archive ZIP écrite octet par octet, depuis l'APPNOTE : entête local, charge, index central,
/// fin d'index. `aligned` bourre le champ « extra » de chaque entrée pour que sa charge commence
/// sur un multiple de soixante-quatre octets, comme la disposition USDZ l'exige.
fn zip_bytes(entries: &[Entry<'_>], aligned: bool) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for entry in entries {
        let offset = out.len() as u32;
        let mut crc = flate2::Crc::new();
        crc.update(entry.data);
        let padding = padding(out.len() + 30 + entry.name.len(), aligned);
        let sizes = [crc.sum(), entry.data.len() as u32, entry.size];
        out.extend_from_slice(b"PK\x03\x04");
        put(&mut out, &[20, 0, entry.method, 0, 0]);
        out.extend(sizes.iter().flat_map(|value| value.to_le_bytes()));
        put(&mut out, &[entry.name.len() as u16, padding.len() as u16]);
        out.extend_from_slice(entry.name.as_bytes());
        out.extend_from_slice(&padding);
        out.extend_from_slice(entry.data);
        central.extend_from_slice(b"PK\x01\x02");
        put(&mut central, &[20, 20, 0, entry.method, 0, 0]);
        central.extend(sizes.iter().flat_map(|value| value.to_le_bytes()));
        put(&mut central, &[entry.name.len() as u16, 0, 0, 0, 0]);
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(entry.name.as_bytes());
    }
    let offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(b"PK\x05\x06");
    let count = entries.len() as u16;
    put(&mut out, &[0, 0, count, count]);
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&offset.to_le_bytes());
    put(&mut out, &[0]);
    out
}

/// Le champ « extra » qui aligne une charge commençant à ce rang. Il porte son propre entête de
/// quatre octets, donc un bourrage plus court qu'eux se reporte à l'alignement suivant.
fn padding(head: usize, aligned: bool) -> Vec<u8> {
    let mut length = match aligned {
        true => (64 - head % 64) % 64,
        false => 0,
    };
    if length == 0 {
        return Vec::new();
    }
    if length < 4 {
        length += 64;
    }
    let mut out = Vec::new();
    put(&mut out, &[0x1986, length as u16 - 4]);
    out.resize(length, 0);
    out
}

/// Des entiers de seize bits à la suite, tels que le format les écrit.
fn put(out: &mut Vec<u8>, values: &[u16]) {
    out.extend(values.iter().flat_map(|value| value.to_le_bytes()));
}
