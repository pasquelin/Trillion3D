//! Measurement and comparison of lot B item: reference, optimized version, same
//! inputs, binary fingerprint on both sides and median in milliseconds for each.
use std::hint::black_box;
use std::time::{Duration, Instant};

/// Minimum rounds of measurement, and duration beyond which execution stops.
const MIN_ROUNDS: usize = 50;
const MIN_SAMPLES: usize = 3;
const TIME_BUDGET: Duration = Duration::from_secs(2);

/// Binary result fingerprint: floats by bits, lengths, bytes.
/// Two results "identical" when fingerprints equal byte for byte.
#[derive(Default, PartialEq, Eq)]
pub(crate) struct Bits(Vec<u8>);
impl Bits {
    pub(crate) fn f64(&mut self, value: f64) {
        self.0.extend_from_slice(&value.to_bits().to_le_bytes());
    }
    pub(crate) fn f32(&mut self, value: f32) {
        self.0.extend_from_slice(&value.to_bits().to_le_bytes());
    }
    pub(crate) fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_le_bytes());
    }
    pub(crate) fn u32(&mut self, value: u32) {
        self.u64(u64::from(value));
    }
    pub(crate) fn len(&mut self, value: usize) {
        self.u64(value as u64);
    }
    pub(crate) fn flag(&mut self, value: bool) {
        self.0.push(u8::from(value));
    }
    pub(crate) fn bytes(&mut self, value: &[u8]) {
        self.len(value.len());
        self.0.extend_from_slice(value);
    }
    pub(crate) fn text(&mut self, value: &str) {
        self.bytes(value.as_bytes());
    }
}

/// Comparative table row.
pub(crate) struct Row {
    pub(crate) calcul: String,
    pub(crate) fichier: &'static str,
    pub(crate) taille: String,
    pub(crate) avant: Option<f64>,
    pub(crate) apres: Option<f64>,
    pub(crate) identique: Option<bool>,
    pub(crate) tours: usize,
    pub(crate) note: String,
}
impl Row {
    pub(crate) fn gain(&self) -> Option<f64> {
        match (self.avant, self.apres) {
            (Some(avant), Some(apres)) if avant > 0.0 => Some((avant - apres) / avant * 100.0),
            _ => None,
        }
    }
    pub(crate) fn retenu(&self) -> bool {
        self.note.is_empty()
            && self.identique == Some(true)
            && matches!((self.avant, self.apres), (Some(a), Some(b)) if b < a)
    }
    /// Reason item not retained, measured or not.
    pub(crate) fn ecarte(mut self, note: &str) -> Self {
        self.note = note.into();
        self
    }
    /// Unmeasured item: deferred, already done, out of bench.
    pub(crate) fn note(calcul: &str, fichier: &'static str, note: &str) -> Self {
        Self {
            calcul: calcul.into(),
            fichier,
            taille: String::new(),
            avant: None,
            apres: None,
            identique: None,
            tours: 0,
            note: note.into(),
        }
    }
}

fn median(mut samples: Vec<f64>) -> f64 {
    samples.sort_by(f64::total_cmp);
    let middle = samples.len() / 2;
    if samples.len().is_multiple_of(2) {
        (samples[middle - 1] + samples[middle]) * 0.5
    } else {
        samples[middle]
    }
}

fn turn<T>(run: &mut dyn FnMut() -> T, into: &mut Vec<f64>) {
    let started = Instant::now();
    black_box(run());
    into.push(started.elapsed().as_secs_f64() * 1000.0);
}

/// Both implementations alternate round by round: neither benefits from freshly
/// arranged heap or warm cache, machine drift affects both equally.
fn measure<T>(
    reference: &mut dyn FnMut() -> T,
    optimise: &mut dyn FnMut() -> T,
) -> (f64, f64, usize) {
    for _ in 0..MIN_SAMPLES {
        black_box(reference());
        black_box(optimise());
    }
    let mut avant: Vec<f64> = Vec::new();
    let mut apres: Vec<f64> = Vec::new();
    let started = Instant::now();
    while avant.len() < MIN_SAMPLES || (avant.len() < MIN_ROUNDS && started.elapsed() < TIME_BUDGET)
    {
        turn(reference, &mut avant);
        turn(optimise, &mut apres);
    }
    let tours = avant.len();
    (median(avant), median(apres), tours)
}

/// Runs both implementations on same inputs, compares fingerprints, then measures.
pub(crate) fn compare<T>(
    calcul: &str,
    fichier: &'static str,
    taille: String,
    reference: &mut dyn FnMut() -> T,
    optimise: &mut dyn FnMut() -> T,
    empreinte: fn(&T) -> Bits,
) -> Row {
    let identique = empreinte(&reference()) == empreinte(&optimise());
    let (avant, apres, tours) = measure(reference, optimise);
    Row {
        calcul: calcul.into(),
        fichier,
        taille,
        avant: Some(avant),
        apres: Some(apres),
        identique: Some(identique),
        tours,
        note: String::new(),
    }
}
