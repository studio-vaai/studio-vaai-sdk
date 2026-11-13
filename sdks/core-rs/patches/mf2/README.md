# rust-mf2, vendored

The crates in `vendor/mf2/` are **rust-mf2**, Evan Carroll's implementation of
[Unicode MessageFormat 2](https://unicode.org/reports/tr35/tr35-messageFormat.html):

- Source: <https://github.com/EvanCarroll/rust-mf2>, crates.io version 3.0.0,
  published from commit `d598787b23e5c7841dd2a021ae2beffef32303c8`.
- Copyright (c) 2026 Evan Carroll, under the MIT License: each crate's
  `LICENSE`.
- `mf2-locale-data` carries tables derived from the Unicode Common Locale
  Data Repository (CLDR), Copyright © 2015-2024 Unicode, Inc., under the
  Unicode License v3: its `LICENSE-UNICODE`. The catalogs the SDK builds from
  them carry CLDR-derived plural rules and number symbols.

Each crate keeps its upstream manifest, authors and license. We changed them
as `patches/mf2/` records; this file is copied beside the crates from there.

| Crate                                                      | What the SDK uses it for                             |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `mf2-model`, `mf2-catalog`, `mf2-runtime`, `mf2-fn-number` | formatting messages                                  |
| `mf2-syntax`                                               | parsing a host's message overrides                   |
| `mf2-build`, `mf2-resource`, `mf2-locale-data`             | compiling the SDK's messages (`formatting/build.rs`) |

## Changes

The packages are unpacked as published, beside upstream's `clippy.toml` from
the same commit (no package carries it; the crates lint clean with it), then:

1. The files the drop list in `patches/mf2/upstream.toml` names are removed:
   packaging leftovers, the ICU4X date backend's tests, and the currency and
   unit tables with theirs.
2. A vendored crate depends on another by `path`.
3. The patches apply in order:
   - `0001` — `mf2-catalog`'s writer finds decomposing code points from a
     table instead of scanning every code point (5-6 ms to about 20 µs per
     compile).
   - `0002` — `mf2-locale-data` and `mf2-build` without the ICU4X date
     backend (`icu-blob`).
   - `0003` — `mf2-locale-data` without the currency and unit tables.
   - `0004` — `mf2-catalog`'s `linear` tests without the timed sweep over
     every adversarial shape, whose wall-clock bounds failed on a loaded
     machine.

Each patch's header says who wrote it, why, and whether it has been offered
upstream.

## Working on it

Edit nothing in `vendor/mf2/` without recording it:

```bash
just mf2-patch short-name-of-the-change   # vendor/mf2's edits as the next patch
```

```bash
just mf2-refresh 1   # vendor/mf2's edits folded into patch 0001 instead
```

```bash
just mf2-check   # vendor/mf2 is exactly packages + drop list + patches (CI runs it)
```

```bash
just mf2-vendor  # rebuild vendor/mf2, as after changing upstream.toml
```

To move to a new upstream version, update `version`, `commit` and the
checksums in `upstream.toml`, run `just mf2-vendor`, and fix any patch that no
longer applies. Remove files through the drop list, never through a patch.
