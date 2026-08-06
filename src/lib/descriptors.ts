// How each RDKit descriptor is presented. Pure and client-safe.
//
// THIS FILE IS THE EXTENSION POINT. The chemistry service can compute far
// more than it currently returns, and the intent is to add fields over time.
// The contract is:
//
//   * A new key returned by the service needs NO change here to appear —
//     it renders with a humanised label and its raw value, in the order the
//     service sent it, after the known ones.
//   * Adding one line below gives it a proper label, a unit, a tooltip and
//     a fixed position. That is the whole cost of a new descriptor.
//
// So never gate rendering on a key being listed here, and never turn the
// registry into a required allow-list.

export interface DescriptorMeta {
  label: string;
  /** Appended after the value, e.g. "Å²". Not converted by the unit toggle:
      these are computed quantities in their own conventional units, not
      measured SI properties. */
  unit?: string;
  /** Shown on hover — what the number means, in one line. */
  hint?: string;
  /** Fixed decimal places. Omit to print the number as it arrived. */
  decimals?: number;
}

/** Registry order is display order. */
export const DESCRIPTOR_META: Record<string, DescriptorMeta> = {
  logp: {
    label: 'LogP',
    hint: 'Crippen estimate of the octanol–water partition coefficient — higher is more oily, lower more water-friendly',
    decimals: 2,
  },
  tpsa: {
    label: 'Polar surface area',
    unit: 'Å²',
    hint: 'Topological polar surface area, summed over polar atoms',
    decimals: 2,
  },
  hbd: { label: 'H-bond donors', hint: 'Groups able to donate a hydrogen bond' },
  hba: { label: 'H-bond acceptors', hint: 'Groups able to accept a hydrogen bond' },
  rotatable_bonds: {
    label: 'Rotatable bonds',
    hint: 'Single bonds free to turn — a measure of how floppy the molecule is',
  },
  rings: { label: 'Rings' },
  aromatic_rings: { label: 'Aromatic rings' },
  heavy_atoms: { label: 'Heavy atoms', hint: 'Every atom except hydrogen' },
  formal_charge: { label: 'Formal charge' },
  fraction_csp3: {
    label: 'Fraction Csp³',
    hint: 'Share of carbons that are fully saturated — 0 is entirely flat and aromatic, 1 entirely tetrahedral',
    decimals: 3,
  },
};

export interface DescriptorRow {
  key: string;
  label: string;
  unit?: string;
  hint?: string;
  value: string;
  /** False when the key is not in the registry — rendered, but unlabelled. */
  known: boolean;
}

/** "fraction_csp3" -> "Fraction csp3". Only used for keys nobody has named yet. */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatValue(value: unknown, meta?: DescriptorMeta): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '—');
  return meta?.decimals !== undefined ? value.toFixed(meta.decimals) : String(value);
}

/**
 * Turn whatever the service sent into display rows: registry entries first in
 * registry order, then anything unrecognised in arrival order.
 */
export function descriptorRows(descriptors: Record<string, unknown>): DescriptorRow[] {
  const rows: DescriptorRow[] = [];
  const seen = new Set<string>();

  for (const [key, meta] of Object.entries(DESCRIPTOR_META)) {
    if (!(key in descriptors)) continue;
    seen.add(key);
    rows.push({
      key,
      label: meta.label,
      unit: meta.unit,
      hint: meta.hint,
      value: formatValue(descriptors[key], meta),
      known: true,
    });
  }

  for (const [key, value] of Object.entries(descriptors)) {
    if (seen.has(key)) continue;
    rows.push({ key, label: humanise(key), value: formatValue(value), known: false });
  }

  return rows;
}
