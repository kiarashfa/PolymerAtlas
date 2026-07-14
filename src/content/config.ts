import { defineCollection, z } from 'astro:content';
import erasData from '../data/taxonomy/eras.json';
import { polymerDataSchema } from './polymer-data-schema';
import { conceptDataSchema } from './concept-data-schema';

// Tier 1 Split-pass output: narrative body + minimal frontmatter only.
// The full §3.3 locked property schema (thermal/mechanical/chemical/etc.)
// lives in a separate `data` collection, built out during the Enrichment
// pass — see instructions.md §3.4 ("two separate files, never merged").
const eraNames = erasData.map((e) => e.name) as [string, ...string[]];

const narrativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  abbreviation: z.array(z.string()).default([]),
  page_type: z.enum(['polymer_hub', 'polymer_variant', 'concept']),
  parent: z.string().nullable().default(null),
  year_of_origin: z.number(),
  era: z.enum(eraNames),
  tagline: z.string().nullable().default(null),
  key_figures: z.array(z.string()).default([]),
  // Locked per §4.4: always auditable which pages are hand-written vs. Claude-authored.
  narrative_author: z.enum(['owner-authored', 'claude-authored']),
});

const polymers = defineCollection({ type: 'content', schema: narrativeSchema });
const concepts = defineCollection({ type: 'content', schema: narrativeSchema });

// Structured data files, keyed by the same id as the narrative collection
// above. polymerData follows the locked §3.3 schema; conceptData is a
// lighter, not-locked schema (§3.1 item 3) built when era 2 enrichment
// first reached a concept entry.
const polymerData = defineCollection({ type: 'data', schema: polymerDataSchema });
const conceptData = defineCollection({ type: 'data', schema: conceptDataSchema });

export const collections = { polymers, concepts, polymerData, conceptData };
