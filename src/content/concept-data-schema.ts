import { z } from 'astro:content';
import erasData from '../data/taxonomy/eras.json';
import { imageObjectSchema } from './schema-shared';

const eraNames = erasData.map((e) => e.name) as [string, ...string[]];

// Concept/theory-page data schema. Unlike the polymer schema (§3.3), this is
// NOT locked in instructions.md -- §3.1 item 3 only specifies the *kind* of
// content a concept page needs (equations rendered via KaTeX at build time,
// derivations, worked examples, occasional bespoke figures), not a fixed
// field list. Kept intentionally lighter than polymerDataSchema; expect to
// extend as more concept entries (Era 2+) reveal what's actually needed.
const keyEquationSchema = z.object({
  name: z.string(),
  latex: z.string(), // rendered at build time via remark-math + rehype-katex, never client-side
  variables: z
    .array(
      z.object({
        symbol: z.string(),
        meaning: z.string(),
        unit: z.string().optional(),
      })
    )
    .default([]),
  source: z.string().optional(), // citation key into references.bib
});

export const conceptDataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),

  year_of_origin: z.number(),
  era: z.enum(eraNames),
  key_figures: z.array(z.string()).default([]),
  historical_events_referenced: z.array(z.string()).default([]),
  historical_images: z.array(imageObjectSchema).default([]),

  summary: z.string(),
  key_equations: z.array(keyEquationSchema).default([]),

  references: z.array(z.string()).default([]), // citation keys into references.bib
});

export type ConceptData = z.infer<typeof conceptDataSchema>;
