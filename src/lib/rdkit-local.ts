// The in-browser chemistry engine: RDKit compiled to WebAssembly, self-hosted
// under public/vendor/rdkit/ (never a CDN — same rule as 3Dmol.js, and this
// site makes no third-party requests).
//
// It is the SECOND engine. The service is the default because nobody should
// download ~6.8 MB of WebAssembly to read an encyclopedia; this exists for a
// reader who wants the tool to work offline, or who finds the service down.
// Once fetched the browser caches it, and every later lookup is instant and
// needs no network at all.
//
// The contract is that a result from here is INDISTINGUISHABLE from a result
// from the service: same MoleculeResult shape, same units, same mono SVG in
// currentColor. Anything the two cannot agree on is reported as absent rather
// than silently different.

import type { ApiResult, MoleculeResult } from './chem-api';

/** Only the handful of MinimalLib calls this file makes. */
interface JSMol {
  get_smiles(): string;
  get_inchi(): string;
  get_json(): string;
  get_descriptors(): string;
  get_svg(width: number, height: number): string;
  delete(): void;
}
interface RDKitModule {
  version(): string;
  get_mol(smiles: string): JSMol | null;
  get_inchikey_for_inchi(inchi: string): string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    initRDKitModule?: (config?: { locateFile?: () => string }) => Promise<RDKitModule>;
  }
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const SCRIPT_URL = `${BASE}/vendor/rdkit/RDKit_minimal.js`;
const WASM_URL = `${BASE}/vendor/rdkit/RDKit_minimal.wasm`;

let modulePromise: Promise<RDKitModule> | null = null;

/** True once the engine is in memory — used to label the control honestly. */
export function isLocalEngineLoaded(): boolean {
  return loaded;
}
let loaded = false;

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.initRDKitModule) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('script failed')));
    document.head.append(script);
  });
}

/** Fetch and start the engine. Safe to call repeatedly — one load per session. */
export function loadLocalEngine(): Promise<RDKitModule> {
  modulePromise ??= (async () => {
    await injectScript();
    if (!window.initRDKitModule) throw new Error('RDKit did not register itself');
    const rdkit = await window.initRDKitModule({ locateFile: () => WASM_URL });
    loaded = true;
    return rdkit;
  })();
  return modulePromise;
}

// --- formula ------------------------------------------------------------
//
// MinimalLib computes every descriptor the service returns except the
// molecular formula, so it is derived here from RDKit's own CommonChem JSON:
// atomic numbers plus implicit hydrogens, printed in Hill order.

const ELEMENTS = [
  '*', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S',
  'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge',
  'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',
  'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba',
];

interface CommonChemAtom {
  z?: number;
  impHs?: number;
  chg?: number;
}

function formulaAndCharge(molJson: string): { formula: string; charge: number; dummies: number } {
  const parsed = JSON.parse(molJson) as {
    defaults?: { atom?: CommonChemAtom };
    molecules?: { atoms?: CommonChemAtom[] }[];
  };
  const defaults = parsed.defaults?.atom ?? {};
  const atoms = parsed.molecules?.[0]?.atoms ?? [];

  const counts = new Map<string, number>();
  const add = (symbol: string, n: number) => counts.set(symbol, (counts.get(symbol) ?? 0) + n);

  let charge = 0;
  let dummies = 0;
  for (const atom of atoms) {
    const z = atom.z ?? defaults.z ?? 6;
    const hydrogens = atom.impHs ?? defaults.impHs ?? 0;
    charge += atom.chg ?? defaults.chg ?? 0;
    if (z === 0) {
      dummies += 1;
      continue;
    }
    add(ELEMENTS[z] ?? `Z${z}`, 1);
    if (hydrogens) add('H', hydrogens);
  }

  // Hill order: carbon, then hydrogen, then everything else alphabetically.
  const rest = [...counts.keys()].filter((s) => s !== 'C' && s !== 'H').sort();
  const order = [...(counts.has('C') ? ['C'] : []), ...(counts.has('H') ? ['H'] : []), ...rest];
  let formula = order.map((s) => `${s}${counts.get(s)! > 1 ? counts.get(s) : ''}`).join('');
  // The service prints a repeat unit's open valences the same way, e.g. C8H8*2.
  if (dummies) formula += dummies > 1 ? `*${dummies}` : '*';
  if (charge) formula += charge > 0 ? `+${charge > 1 ? charge : ''}` : `-${charge < -1 ? -charge : ''}`;

  return { formula, charge, dummies };
}

// --- depiction ----------------------------------------------------------

const SVG_PROLOGUE = /<\?xml[^>]*\?>\s*|<!DOCTYPE[^>]*>\s*/gi;
// MinimalLib paints an opaque white ground as a <rect …> … </rect> PAIR, not
// a self-closing tag. Matching only `/>` left it in place, and the blanket
// hex-to-currentColor pass below then turned it into a solid block of ink —
// a black rectangle over the whole drawing. Strip it first, either spelling.
const WHITE_BACKDROP = /<rect[^>]*fill:#FFFFFF[^>]*(?:\/>|>\s*<\/rect>)\s*/gi;
const ANY_HEX = /#[0-9A-Fa-f]{6}\b/g;
const SIZE_ATTRS = /\s(?:width|height)=(?:'[^']*'|"[^"]*")/g;

/** Same treatment the service applies: transparent, mono, unsized. */
function normaliseSvg(svg: string): string {
  const out = svg
    .replace(SVG_PROLOGUE, '')
    .replace(WHITE_BACKDROP, '')
    .replace(ANY_HEX, 'currentColor');
  // Strip the fixed size from the opening <svg …> tag only, leaving viewBox.
  const close = out.indexOf('>');
  const sized = close === -1 ? out : out.slice(0, close).replace(SIZE_ATTRS, '') + out.slice(close);
  return sized.trim();
}

const round = (value: number, places: number) => Number(value.toFixed(places));

/**
 * The same answer the service gives, computed here. Returns the shared
 * ApiResult so callers cannot tell which engine served them.
 */
export async function describeLocally(
  smiles: string,
  width: number,
  height: number
): Promise<ApiResult<MoleculeResult>> {
  let rdkit: RDKitModule;
  try {
    rdkit = await loadLocalEngine();
  } catch {
    return {
      ok: false,
      error: { code: 'network', message: 'The in-browser engine could not be loaded.' },
    };
  }

  const mol = rdkit.get_mol(smiles);
  if (!mol) {
    return { ok: false, error: { code: 'bad_smiles', message: `RDKit could not parse '${smiles}'.` } };
  }

  try {
    const d = JSON.parse(mol.get_descriptors()) as Record<string, number>;
    const { formula, charge, dummies } = formulaAndCharge(mol.get_json());

    // An open fragment has no InChI, and neither engine invents one.
    let inchi: string | null = null;
    let inchikey: string | null = null;
    try {
      inchi = mol.get_inchi() || null;
      if (inchi) inchikey = rdkit.get_inchikey_for_inchi(inchi) || null;
    } catch {
      /* leave both absent */
    }

    return {
      ok: true,
      data: {
        input: smiles,
        input_type: 'smiles',
        resolved_from: null,
        cached: false,
        smiles: mol.get_smiles(),
        formula,
        molecular_weight: round(d.amw, 3),
        exact_mass: round(d.exactmw, 4),
        inchi,
        inchikey,
        dummy_atoms: dummies,
        descriptors: {
          logp: round(d.CrippenClogP, 2),
          tpsa: round(d.tpsa, 2),
          hbd: d.NumHBD,
          hba: d.NumHBA,
          rotatable_bonds: d.NumRotatableBonds,
          rings: d.NumRings,
          aromatic_rings: d.NumAromaticRings,
          heavy_atoms: d.NumHeavyAtoms,
          formal_charge: charge,
          fraction_csp3: round(d.FractionCSP3, 3),
        },
        svg: normaliseSvg(mol.get_svg(width, height)),
      },
    };
  } finally {
    // MinimalLib molecules live in WASM memory and are not garbage collected.
    mol.delete();
  }
}
