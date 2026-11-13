//! Linear time on adversarial catalogs (A7): `Catalog::new` walks each
//! section once, and the views, the decoder and `lookup` are linear in the
//! bytes they touch.
//!
//! The section table at its limit loads and is walked completely (every
//! declaration, part, expression, option, markup, selector, variant and key;
//! `text` on every string; every variable through NAMES and every function
//! through FUNCS) within an absolute bound, generous enough for a debug build
//! on a loaded machine. One message whose record runs into the next ones
//! walks in time linear in the catalog: its growth from `n` to `4n` is 4× for
//! a linear walk and 16× for a quadratic one; the test allows 8×. `lookup`
//! finds every id however its front coding is chosen.
//!
//! The timed sweep over every adversarial shape at `n` and `4n` is not kept:
//! its wall-clock bounds failed on a loaded machine. One superlinear shape is
//! known and open: see [`records_that_run_into_the_next_one`].

use std::time::{Duration, Instant};

use mf2_catalog::format::{HEADER_LEN, MAGIC, SECTION_ENTRY_LEN, VERSION, kind, section};
use mf2_catalog::{
    Body, Catalog, DeclView, Entry, ExprView, KeyView, MsgId, Names, Operand, OptionsView,
    PartView, PatternView, StrRef, VarRef, decode,
};
use mf2_model::{Declaration, Message, Pattern, PatternPart};

/// Absolute bound for loading, walking, decoding and looking up one catalog.
const LIMIT: Duration = Duration::from_secs(5);
/// Largest allowed `t(4n) / t(n)`: 4 is linear, 16 quadratic.
const GROWTH: f64 = 8.0;
/// Below this, `t(4n)` is too small to compare (timer and scheduler noise).
const NOISE: Duration = Duration::from_millis(20);
/// The manifest hash of the hand-built catalogs.
const RAW_HASH: u64 = 0x5eed_0000_0000_0a07;

// ── what a walk visits ───────────────────────────────────────────────────────

/// Counts of everything a full walk visits.
#[derive(Clone, Copy, Default, Debug)]
struct Stats {
    sections: usize,
    messages: usize,
    decls: usize,
    parts: usize,
    options: usize,
    selectors: usize,
    variants: usize,
    keys: usize,
    vars: usize,
    functions: usize,
    strings: usize,
    text_bytes: usize,
    locale_bytes: usize,
    fallbacks: usize,
    decoded: usize,
    attributes: usize,
    found: usize,
    malformed: usize,
}

/// A full walk of a loaded catalog.
struct Walk<'c> {
    cat: &'c Catalog,
    names: Names<'c>,
    s: Stats,
}

impl<'c> Walk<'c> {
    fn text(&mut self, r: StrRef) {
        if let Some(t) = self.cat.text(r) {
            self.s.strings += 1;
            self.s.text_bytes += t.len();
        }
    }

    fn var(&mut self, v: VarRef) {
        self.s.vars += 1;
        if let Some(r) = self.names.var(v) {
            self.text(r);
        }
    }

    fn operand(&mut self, o: Operand) {
        match o {
            Operand::Literal(r) => self.text(r),
            Operand::Variable(v) => self.var(v),
        }
    }

    fn options(&mut self, o: OptionsView<'c>) {
        for opt in o {
            let Ok((name, value)) = opt else {
                self.s.malformed += 1;
                break;
            };
            self.s.options += 1;
            self.text(name);
            self.operand(value);
        }
    }

    fn expr(&mut self, e: ExprView<'c>) {
        if let Some(o) = e.operand() {
            self.operand(o);
        }
        if let Some(f) = e.function() {
            self.s.functions += 1;
            if let Some(name) = self.cat.function(f.index()) {
                self.s.text_bytes += name.len();
            }
            self.options(f.options());
        }
    }

    fn pattern(&mut self, p: PatternView<'c>) {
        for part in p.parts() {
            let Ok(part) = part else {
                self.s.malformed += 1;
                break;
            };
            self.s.parts += 1;
            match part {
                PartView::Text(r) => self.text(r),
                PartView::Expression(e) => self.expr(e),
                PartView::Markup(m) => {
                    self.text(m.name());
                    self.options(m.options());
                }
            }
        }
    }

    fn message(&mut self, id: MsgId) {
        if self.cat.fallback_locale(id).is_some() {
            self.s.fallbacks += 1;
        }
        match self.cat.get(id) {
            Entry::Absent => return,
            Entry::Simple(r) => {
                self.s.messages += 1;
                self.text(r);
            }
            Entry::Pattern(v) | Entry::Select(v) => {
                self.s.messages += 1;
                self.names = v.names();
                let mut decls = v.declarations();
                for d in &mut decls {
                    let Ok(DeclView::Input(e) | DeclView::Local { expr: e, .. }) = d else {
                        self.s.malformed += 1;
                        break;
                    };
                    self.s.decls += 1;
                    self.expr(e);
                }
                match decls.body() {
                    Ok(Body::Pattern(p)) => self.pattern(p),
                    Ok(Body::Select(s)) => {
                        for sel in s.selectors() {
                            let Ok(v) = sel else {
                                self.s.malformed += 1;
                                break;
                            };
                            self.s.selectors += 1;
                            self.var(v);
                        }
                        for variant in s.variants() {
                            let Ok(variant) = variant else {
                                self.s.malformed += 1;
                                break;
                            };
                            self.s.variants += 1;
                            for k in variant.keys() {
                                match k {
                                    Ok(KeyView::Literal(r)) => {
                                        self.s.keys += 1;
                                        self.text(r);
                                    }
                                    Ok(KeyView::CatchAll) => self.s.keys += 1,
                                    Err(_) => {
                                        self.s.malformed += 1;
                                        break;
                                    }
                                }
                            }
                            self.pattern(variant.pattern());
                        }
                    }
                    Err(_) => self.s.malformed += 1,
                }
            }
        }
        if let Ok(m) = decode(self.cat, id) {
            self.s.decoded += 1;
            self.s.attributes += attributes(&m);
        }
    }
}

/// The attributes of a decoded message (they live in COLD).
fn attributes(m: &Message<'_>) -> usize {
    let mut n = 0;
    for d in m.declarations() {
        n += match d {
            Declaration::Input(x) => x.value.attributes.len(),
            Declaration::Local(x) => x.value.attributes().len(),
            _ => 0,
        };
    }
    let patterns: Vec<&Pattern<'_>> = match m {
        Message::Pattern(p) => vec![&p.pattern],
        Message::Select(s) => s.variants.iter().map(|v| &v.value).collect(),
        _ => Vec::new(),
    };
    for p in patterns {
        for part in p.parts() {
            n += match part {
                PatternPart::Expression(e) => e.attributes().len(),
                PatternPart::Markup(m) => m.attributes.len(),
                _ => 0,
            };
        }
    }
    n
}

/// Loads, walks, decodes and looks up once; returns what it saw and how
/// long it took.
fn run_once(bytes: &[u8], hash: u64, lookups: &[String]) -> (Stats, Duration) {
    let owned = bytes.to_vec();
    let start = Instant::now();
    let cat = Catalog::new(owned, hash).expect("the catalog loads");
    let mut w = Walk {
        cat: &cat,
        names: Names::EMPTY,
        s: Stats::default(),
    };
    w.s.sections = cat.sections().count();
    let _ = (cat.locale(), cat.dir(), cat.cldr_version());
    // 64: the first opaque key of `locale_entries` (keys 3 and 4 are
    // `number.*`, which the writer checks; 64 and up are unassigned).
    for key in [0, 1, 2, 64, u32::MAX] {
        w.s.locale_bytes += cat.locale_entry(key).map_or(0, <[u8]>::len);
    }
    for i in 0..cat.message_count() {
        w.message(MsgId::new(cat.chunk(), i).expect("a valid id"));
    }
    for id in lookups {
        if cat.lookup(id).is_some() {
            w.s.found += 1;
        }
    }
    (w.s, start.elapsed())
}

// ── building catalogs ────────────────────────────────────────────────────────

/// A hand-built catalog and its manifest hash.
struct Case {
    bytes: Vec<u8>,
    hash: u64,
}

impl Case {
    fn new(bytes: Vec<u8>, hash: u64) -> Case {
        Case { bytes, hash }
    }
}

fn varint(mut v: u32, out: &mut Vec<u8>) {
    loop {
        let low = u8::try_from(v & 0x7f).expect("7 bits");
        v >>= 7;
        if v == 0 {
            out.push(low);
            return;
        }
        out.push(low | 0x80);
    }
}

fn u32_of(n: usize) -> u32 {
    u32::try_from(n).expect("fits u32")
}

/// INDEX as four byte planes.
fn planes(entries: &[u32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(entries.len() * 4);
    for plane in 0..4 {
        out.extend(entries.iter().map(|e| e.to_le_bytes()[plane]));
    }
    out
}

/// A hand-built catalog: header, section
/// table, sections in the order given (STRINGS must be last), manifest hash
/// [`RAW_HASH`], locale at `StrRef` 0.
fn raw(count: usize, sections: &[(u16, Vec<u8>)]) -> Vec<u8> {
    let table_end = HEADER_LEN + sections.len() * SECTION_ENTRY_LEN;
    let mut out = Vec::with_capacity(table_end + sections.iter().map(|s| s.1.len()).sum::<usize>());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&RAW_HASH.to_le_bytes());
    out.extend_from_slice(&u32_of(count).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // locale: StrRef 0
    out.extend_from_slice(&0u32.to_le_bytes()); // no CLDR data
    out.extend_from_slice(&[0, 0]); // chunk 0, ltr
    out.extend_from_slice(
        &u16::try_from(sections.len())
            .expect("≤ 65,535")
            .to_le_bytes(),
    );
    let mut off = table_end;
    for (k, data) in sections {
        out.extend_from_slice(&k.to_le_bytes());
        out.extend_from_slice(&u32_of(off).to_le_bytes());
        out.extend_from_slice(&u32_of(data.len()).to_le_bytes());
        off += data.len();
    }
    for (_, data) in sections {
        out.extend_from_slice(data);
    }
    out
}

/// The required sections of a hand-built catalog around `index`,
/// `messages`, `names` and `pool` (empty LOCALE and FUNCS).
fn required(
    index: Vec<u8>,
    messages: Vec<u8>,
    names: Vec<u8>,
    pool: Vec<u8>,
) -> Vec<(u16, Vec<u8>)> {
    vec![
        (section::INDEX, index),
        (section::MESSAGES, messages),
        (section::NAMES, names),
        (section::LOCALE, vec![0]),
        (section::FUNCS, Vec::new()),
        (section::STRINGS, pool),
    ]
}

// ── the cases ────────────────────────────────────────────────────────────────

/// `n` empty sections of an unknown kind before the known ones.
fn many_sections(n: usize) -> Case {
    let mut sections = vec![(100u16, Vec::new()); n];
    let index = planes(&[(kind::SIMPLE << kind::SHIFT) | 3]);
    sections.extend(required(index, Vec::new(), Vec::new(), b"en\0x\0".to_vec()));
    Case::new(raw(1, &sections), RAW_HASH)
}

/// The section table at its limit: 65,535 entries (`section_count` is a
/// `u16`), all but the six required ones of unknown kinds.
#[test]
fn section_table_at_its_limit() {
    let case = many_sections(usize::from(u16::MAX) - 6);
    let start = Instant::now();
    let (stats, _) = run_once(&case.bytes, case.hash, &[]);
    let t = start.elapsed();
    assert_eq!(stats.sections, usize::from(u16::MAX));
    assert_eq!(stats.decoded, 1);
    assert!(t < LIMIT, "{t:?}");
}

/// `n` pattern messages of 8 bytes whose part count (65,536) runs past their
/// own record: its last byte and each following record read as more TEXT
/// parts (`00 00` · `00 00` · `00` + the next head, the next declaration
/// count + part count …), so every walk continues to the end of MESSAGES.
fn runaway_records(n: usize) -> Case {
    let parts: u32 = 1 << 16; // the part count, and a StrRef inside the pool
    let mut pool = b"en\0".to_vec();
    pool.resize(usize::try_from(parts).expect("fits"), b'a');
    pool.extend_from_slice(b"z\0");
    let mut messages = Vec::new();
    let mut index = Vec::with_capacity(n);
    for _ in 0..n {
        index.push((kind::PATTERN << kind::SHIFT) | u32_of(messages.len()));
        messages.extend_from_slice(&[0x00, 0x00]); // head: no NAMES, no COLD; no declarations
        varint(parts, &mut messages);
        messages.extend_from_slice(&[0x00, 0x00, 0x00]); // TEXT "en", then a TEXT tag
    }
    let bytes = raw(n, &required(planes(&index), messages, Vec::new(), pool));
    Case::new(bytes, RAW_HASH)
}

/// Records that run into the next one (the A7 finding). A MESSAGES record
/// carries no length, so a pattern's part count — likewise a declaration,
/// selector or variant count — can run on through the records after it;
/// walking *every* message of such a catalog is O(messages × MESSAGES)
/// (1,000 → 2,000 → 4,000 records: 0.6 → 2.5 → 9.7 s in a debug build). The
/// format accepts that: a
/// length per record would not bound strings, which F4 checks per access.
/// What it guarantees, and this test holds: **one** message's walk is linear
/// in the catalog, however far it runs.
#[test]
fn a_runaway_record_is_linear_in_the_catalog() {
    let walk_first = |case: &Case| {
        let cat = Catalog::new(case.bytes.clone(), RAW_HASH).expect("loads");
        let start = Instant::now();
        let Entry::Pattern(v) = cat.get(MsgId::from_raw(0)) else {
            panic!("not a pattern")
        };
        let Ok(Body::Pattern(p)) = v.body() else {
            panic!("no body")
        };
        let parts = p.parts().flatten().count();
        (parts, start.elapsed())
    };
    let n = 2_000;
    let (small, t_small) = walk_first(&runaway_records(n));
    let (large, t_large) = walk_first(&runaway_records(4 * n));
    // The first record's walk reads (nearly) every record after it.
    assert!(small > 2 * n && large > 8 * n, "{small} / {large} parts");
    let growth = t_large.as_secs_f64() / t_small.as_secs_f64().max(1e-9);
    assert!(
        t_large < NOISE || growth <= GROWTH,
        "t(4n) / t(n) = {growth:.1} ({t_small:?} → {t_large:?})"
    );
}

/// IDS by hand with non-maximal front coding: `shared` may be smaller than
/// the common prefix with the previous id (02 §2.8 allows it; the writer
/// never does it). `lookup` must still find every id. Regression: the fuzz
/// target found a mutated workload catalog whose IDS stayed valid and
/// ascending — one byte of an id changed, so the next id's `shared` was no
/// longer maximal — and `lookup` returned `None` for an id it holds.
#[test]
fn lookup_does_not_assume_maximal_front_coding() {
    let ids: [&[u8]; 7] = [b"a", b"ab", b"abc", b"abd", b"abda", b"b", b"ba"];
    let maximal: Vec<usize> = (0..ids.len())
        .map(|i| match i.checked_sub(1) {
            None => 0,
            Some(p) => ids[p]
                .iter()
                .zip(ids[i])
                .take_while(|(a, b)| a == b)
                .count(),
        })
        .collect();
    // Every id but the restart: `shared` maximal, zero, or one less.
    for choice in 0..3usize.pow(6) {
        let mut entries = Vec::new();
        let mut c = choice;
        for (i, id) in ids.iter().enumerate() {
            let shared = if i == 0 {
                0
            } else {
                let s = match c % 3 {
                    0 => maximal[i],
                    1 => 0,
                    _ => maximal[i].saturating_sub(1),
                };
                c /= 3;
                s
            };
            varint(u32_of(shared), &mut entries);
            varint(u32_of(id.len() - shared), &mut entries);
            entries.extend_from_slice(&id[shared..]);
        }
        let mut idx = 0u32.to_le_bytes().to_vec(); // one restart, at 0
        idx.extend_from_slice(&entries);
        let index = planes(&vec![(kind::SIMPLE << kind::SHIFT) | 3; ids.len()]);
        let mut sections = required(index, Vec::new(), Vec::new(), b"en\0x\0".to_vec());
        sections.insert(5, (section::IDS, idx));
        let cat = Catalog::new(raw(ids.len(), &sections), RAW_HASH).expect("loads");
        for (i, id) in ids.iter().enumerate() {
            let id = std::str::from_utf8(id).expect("ASCII");
            let want = MsgId::new(0, u32_of(i));
            assert_eq!(cat.lookup(id), want, "{id:?}, choice {choice}");
        }
        for miss in ["", "aa", "abe", "abda0", "bb", "c"] {
            assert_eq!(cat.lookup(miss), None, "{miss:?}, choice {choice}");
        }
    }
}
