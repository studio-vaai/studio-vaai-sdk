/** Opens the hidden `<input type="file" accept="image/*,.heic,.heif">` (library-style, no `capture`). */
export function openPhotoLibrary(input: HTMLInputElement | null): void {
  if (!input) {
    return;
  }
  input.value = "";
  input.removeAttribute("capture");
  input.click();
}
