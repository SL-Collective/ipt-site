export function isAndroidApp() {
  try {
    return (document.referrer ?? "").startsWith("android-app://");
  } catch {
    return false;
  }
}
