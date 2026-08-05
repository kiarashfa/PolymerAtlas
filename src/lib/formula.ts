// Typesetting for chemical formulas.
//
// Formulas are stored as plain ASCII in the data files -- "(C3H6)n",
// "[-CH2-CF2-]n", "(C8H8)x·(C4H6)y" -- so they stay diffable, greppable and
// machine-checkable. Subscripts are applied here at render time with real
// <sub> markup rather than Unicode subscript characters, which render
// inconsistently across the three presentation faces and cannot express a
// compound index like "3-x".

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

// What becomes a subscript:
//   1. a digit run following an element symbol or a closing bracket --
//      C3, H6, )2 -- optionally carrying a compound tail like "3-x", the
//      notation the cellulose derivatives need for partial substitution;
//   2. a lone index letter after a closing bracket -- )n, ]x, )y.
// A digit that opens a token is left alone, so locants such as the "1,4" in
// a cis-1,4 label are never lowered.
const SUBSCRIPT =
  /(?<=[A-Za-z)\]])(\d+(?:\s*[-–]\s*[a-z])?)|(?<=[)\]])([nmxyzp])(?![A-Za-z0-9])/g;

/** ASCII formula -> HTML with real subscripts. Input is escaped first, so
 *  this is safe to hand to `set:html`. */
export function formulaHtml(formula: string): string {
  return escapeHtml(formula).replace(SUBSCRIPT, (_m, digits, index) =>
    digits ? `<sub>${digits}</sub>` : `<sub>${index}</sub>`
  );
}

/** Element tally of a formula string, for cross-checking that a hand-written
 *  structural formula describes the same repeat unit as the derived
 *  empirical one. Understands nested (…)k / […]k multipliers and ignores the
 *  polymer index letters, bond dashes and separators.
 *
 *  Returns null when the string uses notation this cannot count honestly --
 *  a variable index like "3-x", an R group, an ellipsis -- so callers can
 *  skip rather than compare against a wrong tally. */
export function atomCounts(formula: string): Record<string, number> | null {
  // R is not an element; a "3-x" index is a variable degree of substitution.
  if (/R(?![a-z])|\.\.\.|…|\d\s*[-–]\s*[a-z]/.test(formula)) return null;

  // Bond notation carries no atoms: single, double and triple bonds are all
  // stripped before counting, as are the separators between copolymer units.
  const tokens = formula.replace(/[·•*\s]/g, '').replace(/[-–—=#]/g, '');
  const counts: Record<string, number> = {};
  const stack: Record<string, number>[] = [counts];
  let i = 0;

  const top = () => stack[stack.length - 1];
  const add = (el: string, n: number) => {
    top()[el] = (top()[el] ?? 0) + n;
  };
  const readCount = () => {
    const m = /^\d+/.exec(tokens.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  };

  while (i < tokens.length) {
    const c = tokens[i];
    if (c === '(' || c === '[') {
      stack.push({});
      i += 1;
    } else if (c === ')' || c === ']') {
      i += 1;
      // A polymer index letter after the bracket means "repeated", not a
      // multiplier we can count -- treat it as one unit.
      if (/^[nmxyzp](?![a-z])/.test(tokens.slice(i))) i += 1;
      const mult = readCount();
      const group = stack.pop();
      if (!group || stack.length === 0) return null;
      for (const [el, n] of Object.entries(group)) add(el, n * mult);
    } else if (/[A-Z]/.test(c)) {
      const m = /^[A-Z][a-z]?/.exec(tokens.slice(i))!;
      i += m[0].length;
      add(m[0], readCount());
    } else if (/[nmxyzp]/.test(c)) {
      i += 1; // stray index letter
    } else {
      return null; // notation this cannot count
    }
  }
  return stack.length === 1 ? counts : null;
}

/** True when two formulas describe the same set of atoms. Either side
 *  returning null (uncountable notation) yields null, not false -- "cannot
 *  tell" is different from "disagrees". */
export function sameAtoms(a: string, b: string): boolean | null {
  const ca = atomCounts(a);
  const cb = atomCounts(b);
  if (!ca || !cb) return null;
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  for (const k of keys) if ((ca[k] ?? 0) !== (cb[k] ?? 0)) return false;
  return true;
}
