// SI ⇄ Imperial unit display — the single shared conversion utility.
// All data files store SI only; imperial values are computed client-side
// on demand (never stored, never indexed). The same helpers build the
// server-rendered SI strings and the client-recomputed imperial strings,
// so the two can never drift apart.

interface ImperialRule {
  /** Imperial unit symbol shown after the converted number. */
  unit: string;
  convert: (si: number) => number;
  /** Formatter for the converted number (default: 3 significant figures). */
  format?: (v: number) => string;
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Rewrite JavaScript's exponential form into typeset scientific notation:
 *  "1.9e-13" -> "1.9 × 10⁻¹³". Properties like gas permeability and the
 *  conductivity of an insulator are unreadable otherwise. Strings without an
 *  exponent pass through untouched. */
function typesetExponent(s: string): string {
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  const [, mantissa, sign, digits] = m;
  const exp = (sign === '-' ? '⁻' : '') + [...digits].map((d) => SUPERSCRIPT[+d]).join('');
  return `${mantissa} × 10${exp}`;
}

/** The SI form: numbers as JSON stringifies them, with exponents typeset. */
function decimal(v: number): string {
  return typesetExponent(String(v));
}

/** Three significant figures, thousands-separated when large. */
function sigFigs(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const n = Number(v.toPrecision(3));
  return Math.abs(n) >= 1000 ? n.toLocaleString('en-US') : typesetExponent(String(n));
}

const wholeNumber = (v: number) => Math.round(v).toLocaleString('en-US');

/** SI unit → imperial conversion rules, for every convertible unit that
 *  actually appears in the data. Unit-system-agnostic units (%, Shore,
 *  g/10min, S/m, dimensionless) are deliberately absent — they render
 *  identically in both systems. */
export const IMPERIAL_RULES: Record<string, ImperialRule> = {
  '°C': { unit: '°F', convert: (c) => (c * 9) / 5 + 32, format: wholeNumber },
  MPa: { unit: 'psi', convert: (v) => v * 145.038 },
  'g/cm³': { unit: 'lb/in³', convert: (v) => v * 0.0361273 },
  'kJ/m²': { unit: 'ft·lb/in²', convert: (v) => v * 0.475846 },
  'J/m': { unit: 'ft·lb/in', convert: (v) => v * 0.0187227 },
  'W/(m·K)': { unit: 'BTU·in/(h·ft²·°F)', convert: (v) => v * 6.93347 },
};

/** Assemble the display string for a value and/or range plus unit —
 *  "v", "v (min–max)", or "min–max", with the unit appended. Number
 *  formatting is injected so SI (verbatim JSON numbers) and imperial
 *  (converted + rounded) share one assembly path. */
export function assembleValue(
  value: number | null,
  min: number | null,
  max: number | null,
  unit: string,
  fmt: (v: number) => string
): string | null {
  const hasRange = min != null && max != null;
  const range = hasRange ? `${fmt(min)}–${fmt(max)}` : null;
  let core: string | null = null;
  if (value != null && range) core = `${fmt(value)} (${range})`;
  else if (value != null) core = fmt(value);
  else if (range) core = range;
  if (core === null) return null;
  const u = unit.trim();
  return u ? `${core} ${u}` : core;
}

/** The server-rendered SI form: numbers verbatim, as JSON stringifies them,
 *  with exponential forms typeset as "m × 10ⁿ". */
export function siText(
  value: number | null,
  min: number | null,
  max: number | null,
  unit: string
): string | null {
  return assembleValue(value, min, max, unit, decimal);
}

/** The client-computed imperial form, or null when the unit is SI-only. */
export function imperialText(
  value: number | null,
  min: number | null,
  max: number | null,
  unit: string
): string | null {
  const rule = IMPERIAL_RULES[unit.trim()];
  if (!rule) return null;
  const fmt = (v: number) => (rule.format ?? sigFigs)(rule.convert(v));
  return assembleValue(value, min, max, rule.unit, fmt);
}
