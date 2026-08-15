import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Sets data-theme on <html> before the browser paints.
 *
 * This has to be a blocking inline script in <head>: ThemeProvider only runs
 * after hydration, so without this a light-mode owner gets a full dark frame
 * first. It reads the same localStorage key the provider writes on every
 * change, which is why that mirror is kept in sync even though the database
 * is the real source of truth.
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = stored === 'dark' || stored === 'light' || stored === 'system'
      ? stored
      : '${DEFAULT_THEME}';
    var resolved = theme === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
