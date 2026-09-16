use super::*;

/// Le nom du verrou dans `<cache>/native`. La purge ne parcourt que `slice`, `full`, `imports` et
/// `objects` : un fichier posé à côté d'eux ne peut pas être effacé par une compilation.
const CACHE_LOCK_FILE: &str = ".lock";
/// Au-delà, une compilation en attente renonce plutôt que d'attendre sans fin.
const WAIT: std::time::Duration = std::time::Duration::from_secs(30);
/// Un verrou que personne ne relâche — compilation tuée, machine redémarrée — cesse de compter
/// passé ce délai, sinon un cache resterait bloqué jusqu'à une intervention manuelle. Il est bien
/// au-delà de toute compilation, donc une compilation vivante ne se fait pas prendre son verrou.
const STALE: std::time::Duration = std::time::Duration::from_secs(6 * 3600);

/// Exclusion mutuelle sur un cache. Un cache ne garde qu'un pointeur par scope et se purge après
/// chaque écriture : deux compilations qui l'écrivent en même temps effacent la clef et les objets
/// que l'autre vient de publier. Le verrou est un fichier créé en exclusion mutuelle et retiré à la
/// sortie, y compris en erreur ou en panique, puisque c'est `Drop` qui le retire.
pub(super) struct CacheLock {
    path: PathBuf,
}

fn abandoned(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|data| data.modified())
        .ok()
        .and_then(|at| at.elapsed().ok())
        .is_some_and(|age| age > STALE)
}

impl CacheLock {
    pub(super) fn acquire(cache: &Path) -> Result<Self> {
        let native = cache.join("native");
        fs::create_dir_all(&native)?;
        let path = native.join(CACHE_LOCK_FILE);
        let deadline = Instant::now() + WAIT;
        loop {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    let _ = write!(file, "{}", std::process::id());
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
            if Instant::now() >= deadline {
                return Err(CompilerError::new(
                    "CACHE_LOCKED",
                    format!(
                        "Cache {} is being written by another compilation",
                        cache.display()
                    ),
                ));
            }
            if abandoned(&path) {
                let _ = fs::remove_file(&path);
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
}

impl Drop for CacheLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
