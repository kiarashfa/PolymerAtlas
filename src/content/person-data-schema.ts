import { z } from 'astro/zod';
import erasData from '../data/taxonomy/eras.json';
import { imageObjectSchema } from './schema-shared';

const eraNames = erasData.map((e) => e.name) as [string, ...string[]];

// Person-page data schema. Person pages exist only for the major historical
// figures of polymer science — a small, closed set, not a general entity
// type. The schema carries a people[] ARRAY, never a single person: the
// Ziegler & Natta page covers two chemists who share one catalyst system
// and one Nobel Prize, and future additions may be joint pages too.
const personSchema = z.object({
  full_name: z.string(),
  born: z.object({ year: z.number(), place: z.string() }),
  died: z.object({ year: z.number(), place: z.string() }),
  nationality: z.string(),
  /** Career stations, in order — institution + years, display strings. */
  institutions: z.array(z.string()).default([]),
  nobel: z
    .object({
      year: z.number(),
      /** The official citation wording (or a faithful shortening). */
      citation: z.string(),
    })
    .nullable()
    .default(null),
  wikipedia_url: z.url(),
});

/** One dated event in the page's combined milestones timeline. */
const milestoneSchema = z.object({
  year: z.number(),
  event: z.string(),
});

export const personDataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),

  /** Anchor year for chronology/chrome — the signature moment of the work
   *  (e.g. 1920 "Über Polymerisation", 1935 first nylon, 1953 catalyst). */
  year_of_origin: z.number(),
  era: z.enum(eraNames),

  people: z.array(personSchema).min(1),
  milestones: z.array(milestoneSchema).default([]),

  /** Name variants for search/autolinking beyond full names + surnames
   *  (e.g. "Ziegler-Natta"). Flag autolinkable:false to exclude one. */
  aliases: z
    .array(z.object({ name: z.string(), autolinkable: z.boolean().default(true) }))
    .default([]),

  historical_events_referenced: z.array(z.string()).default([]),
  historical_images: z.array(imageObjectSchema).default([]),

  references: z.array(z.string()).default([]), // citation keys into references.bib
});

export type PersonData = z.infer<typeof personDataSchema>;
