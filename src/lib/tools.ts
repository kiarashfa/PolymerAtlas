// The Workshop: the Atlas's tools, listed once. The reader's menu, the home
// page, the tools index and the not-found page all read this list, so a new
// tool is added in one place.
import { href } from './content';

export interface Tool {
  href: string;
  name: string;
  /** One line under the name. */
  essence: string;
  /** A single glyph set in a small ruled well. */
  glyph: string;
}

export const TOOLS: Tool[] = [
  {
    href: href('/tools/molecule/'),
    name: 'Molecule Lookup',
    essence: 'Draw and measure any small molecule',
    glyph: '⬡',
  },
  {
    href: href('/tools/predictor/'),
    name: 'Property Predictor',
    essence: 'Four models, from structure alone',
    glyph: '◈',
  },
  {
    href: href('/tools/compare/'),
    name: 'Compare Polymers',
    essence: 'Up to three, side by side',
    glyph: '⇌',
  },
];
