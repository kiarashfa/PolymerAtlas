import { z } from 'astro/zod';
import chemicalFamilies from '../data/taxonomy/chemical-families.json';
import mechanisms from '../data/taxonomy/polymerization-mechanisms.json';

// Compilation/family-page data schema. A compilation page is a cross-cutting
// index: a hand-written intro essay plus a member list that is ALWAYS
// auto-generated at build time from the classification tags already on the
// polymer data files — membership is never hand-maintained here.
const familyTags = chemicalFamilies as string[];
const mechanismTags = mechanisms as string[];

const membershipSchema = z
  .object({
    /** Which classification axis drives membership. */
    axis: z.enum(['chemical_family', 'polymerization_mechanism']),
    /** Taxonomy tags whose entries belong to this page (an entry matching
     *  ANY listed tag is a member — lets "Addition Polymers" union the
     *  chain-growth mechanisms). */
    tags: z.array(z.string()).min(1),
  })
  .superRefine((m, ctx) => {
    const dict = m.axis === 'chemical_family' ? familyTags : mechanismTags;
    for (const tag of m.tags)
      if (!dict.includes(tag))
        ctx.addIssue({
          code: 'custom',
          message: `membership tag "${tag}" is not in the ${m.axis} taxonomy dictionary`,
        });
  });

export const familyDataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),

  /** Presentation grouping for the /families/ index. */
  kind: z.enum(['chemical-family', 'polymerization-mechanism']),
  membership: membershipSchema,

  /** Name variants for search/autolinking (e.g. "polyesters",
   *  "polyester family"). Flag autolinkable:false to exclude one. */
  aliases: z
    .array(z.object({ name: z.string(), autolinkable: z.boolean().default(true) }))
    .default([]),

  references: z.array(z.string()).default([]), // citation keys into references.bib
});

export type FamilyData = z.infer<typeof familyDataSchema>;
