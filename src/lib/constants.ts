export const CF_MATCHES = ['https://codeforces.com/*', 'https://*.codeforces.com/*'];
export const DARK_SCRIPT_ID = 'cfx-theme';
export type DarkTheme = 'slate' | 'dark';
export const themeFile = (t: DarkTheme) => `theme/${t}.css`;
