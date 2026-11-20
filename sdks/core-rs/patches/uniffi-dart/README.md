# uniffi-dart, pinned and patched

The Flutter SDK's Dart bindings come from [uniffi-dart](https://github.com/Uniffi-Dart/uniffi-dart)
(MIT), the community Dart generator for UniFFI. Its releases target UniFFI 0.31, and the core needs
UniFFI 0.32 (the zero-copy `&[u8]` argument, `Box<T>` fields), so `just uniffi-dart` builds the
head of [Uniffi-Dart/uniffi-dart#149](https://github.com/Uniffi-Dart/uniffi-dart/pull/149), its
unmerged UniFFI 0.32 port, at the commit the Justfile pins (`uniffi_dart_rev`, `a9029a4`). That
head is rebased onto upstream main and includes our `Box<T>`/`Set<T>` support
([DenisovAV/uniffi-dart#8](https://github.com/DenisovAV/uniffi-dart/pull/8)). On top of it:

| Patch                          | Fixes                                                                                                                                      | Upstream                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `0001-call-status-shadowing`   | An argument named `status` shadowed the generated call's status parameter.                                                                 | [Uniffi-Dart/uniffi-dart#178](https://github.com/Uniffi-Dart/uniffi-dart/pull/178) |
| `0002-error-inside-type-names` | A type with `Error` inside its name (`InternalServerErrorProblem`), in an enum variant or an `Option`/`Vec`, was named an undeclared type. | [Uniffi-Dart/uniffi-dart#196](https://github.com/Uniffi-Dart/uniffi-dart/pull/196) |

`Cargo.lock` locks the generator's dependencies, so it reads the core's metadata with the same
`uniffi_bindgen` (0.32.2) the core is built with.

0002 is the source change of #196 without its fixture; 0001 is ours, and #178 fixes the same as
part of a broader change. Move the pin to a release once one supports UniFFI 0.32, and drop each
patch once the pinned release includes its upstream pull request.

To change the patches: `just uniffi-dart` leaves the source in `build/uniffi-dart/src`, one commit
per patch on top of the pin. Change the commits there, then replace this folder's patches with
`git format-patch --no-signature --zero-commit <pin>` of them.
