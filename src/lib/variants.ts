// The three Edition presentation styles — a client-side user preference
// switched from the header menu, like light/dark. Each swaps only the
// token overlay (`.variant-<id>` on <html>, incl. its own font family);
// Gilt is the default.
export interface EditionVariant {
  id: 'gilt' | 'vellum' | 'atelier';
  name: string;
  /** One-line essence shown under the name in the header menu. */
  essence: string;
  /** Full description (tooltips, docs). */
  note: string;
}

export const VARIANTS: EditionVariant[] = [
  {
    id: 'gilt',
    name: 'Gilt',
    essence: 'Ivory & gold foil, justified',
    note: 'Ivory paper, gold-foil detailing, justified book text with drop caps. The fine-press private edition.',
  },
  {
    id: 'vellum',
    name: 'Vellum',
    essence: 'Warm parchment, era color leads',
    note: 'Warmer parchment set in Garamond, with no gold (each era’s own color is the only accent), a left-set hero and ragged-right text.',
  },
  {
    id: 'atelier',
    name: 'Atelier',
    essence: 'Cool gallery paper, modern labels',
    note: 'Cool gallery paper set in Constantia, modern uppercase labels, era-color number medallions, softer shadows. The luxury art-book catalogue.',
  },
];
