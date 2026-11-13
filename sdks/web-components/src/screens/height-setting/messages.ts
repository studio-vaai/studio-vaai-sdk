import type { SvUiContext } from "../../ui/index.js";

/** Screen-local composition of the shared Rust MF2 catalog. */
export function heightSettingMessages(ui: SvUiContext) {
  return {
    title: ui.text("heightSetting.title"),
    subtitle: ui.text("heightSetting.subtitle"),
    heightLabel: ui.text("heightSetting.heightPickerLabel"),
    confirm: ui.text("heightSetting.confirm"),
    upload: ui.text("heightSetting.useOtherImage"),
    saving: ui.text("heightSetting.busySaveSr"),
  };
}
