/// Why the fit gate refuses a size.
enum GateRefusal { tooSmall, tooLarge }

/// The fit gate's note, pure (the web's `gateNote`): the catalog message and
/// its values for a refused size, with the sizes already named. A refused
/// size names the next one along the size run that can be tried on, which
/// the primary button offers. Choosing (no result shown yet) reads as a
/// recommendation; over a shown result, as an inspection of the picked size.
/// With no size left in that direction ([next] null) it says there is none.
/// The presentation's [warning] wins over the refusal of a host's size the
/// selection already left ([switched]); with neither there is no note.
///
/// Checked against the web's results in `test/shared_vectors/fit_overlay.json`.
({String key, Map<String, String> values})? gateNoteMessage({
  GateRefusal? warning,
  GateRefusal? switched,
  required String requested,
  String? next,
  required bool choosing,
}) {
  final refusal = warning ?? switched;
  if (refusal == null) return null;
  final tooLarge = refusal == GateRefusal.tooLarge;
  if (next == null) {
    return (
      key: tooLarge
          ? 'sizeAndStyleSelection.garmentTooLargeNoAlternativeNote'
          : 'sizeAndStyleSelection.garmentTooSmallNoAlternativeNote',
      values: {'requestedSize': requested},
    );
  }
  if (choosing) {
    return (
      key: tooLarge
          ? 'sizeAndStyleSelection.garmentTooLargeNote'
          : 'sizeAndStyleSelection.garmentTooSmallNote',
      values: {'requestedSize': requested, 'recommendedSize': next},
    );
  }
  return (
    key: tooLarge ? 'tryOnView.gateInspectTooLargeNote' : 'tryOnView.gateInspectTooSmallNote',
    values: {'sizeLabel': requested, 'recommendedSize': next},
  );
}
