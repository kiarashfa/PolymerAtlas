// Title helpers — pure (no astro:content), usable from page code AND from
// build-time plugins/integrations that run outside the Astro container.

/** Author's page names carry a subtitle after the first colon:
 *  "Polyethylene (PE): The Accidental Wonder That Changed Our World" */
export function splitTitle(full: string): { title: string; subtitle: string | null } {
  const i = full.indexOf(': ');
  if (i === -1) return { title: full, subtitle: null };
  return { title: full.slice(0, i), subtitle: full.slice(i + 2) };
}

/** Display name without the "(PE)" abbreviation parenthetical. */
export const bareName = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '');
