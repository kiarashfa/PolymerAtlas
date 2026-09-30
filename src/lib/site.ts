// Site-wide identity: the facts every page's head and footer need, each
// defined once. The layout, the web manifest and the social card all read
// from here, so a change is always a one-line edit.
import tokensCss from '../styles/tokens.css?raw';

export const SITE_NAME = 'Atlas of Polymers';
export const SITE_SHORT_NAME = 'Atlas';
export const SITE_TAGLINE =
  'a history-narrated encyclopedia of the polymers that made the modern world';

// The copyright line runs from the year the Atlas was first published to the
// year of the build: "© 2026", then "© 2026–2027" once a build lands in 2027.
// The first year is pinned rather than read from git, because a CI checkout
// is shallow and would report the newest commit's year instead.
export const COPYRIGHT_HOLDER = 'Kiarash Farajzadehahary';
const COPYRIGHT_START_YEAR = 2026;
const buildYear = new Date().getFullYear();
export const COPYRIGHT_YEARS =
  buildYear > COPYRIGHT_START_YEAR
    ? `${COPYRIGHT_START_YEAR}–${buildYear}`
    : String(COPYRIGHT_START_YEAR);

// Google Analytics 4 measurement ID. Public by design (it is visible in every
// page's source); this is the only file that holds it.
export const GA_MEASUREMENT_ID = 'G-4LSS274FZ6';

// The page colour, read out of tokens.css rather than restated here, for the
// places that need a literal colour before any CSS has loaded: the browser's
// theme-color and the installed app's splash screen.
const paper = /--paper:\s*light-dark\((#[0-9a-fA-F]{3,8}),\s*(#[0-9a-fA-F]{3,8})\)/.exec(tokensCss);
if (!paper) throw new Error('site.ts: could not read --paper from tokens.css');
export const PAPER_LIGHT = paper[1];
export const PAPER_DARK = paper[2];
