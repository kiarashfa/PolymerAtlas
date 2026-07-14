import { z } from 'astro:content';
import chemicalFamilies from '../data/taxonomy/chemical-families.json';
import backboneClasses from '../data/taxonomy/backbone-classes.json';
import polymerizationMechanisms from '../data/taxonomy/polymerization-mechanisms.json';

export const chemicalFamilyEnum = chemicalFamilies as [string, ...string[]];
export const backboneClassEnum = backboneClasses as [string, ...string[]];
export const polymerizationMechanismEnum = polymerizationMechanisms as [string, ...string[]];

// Status semantics locked in instructions.md §3.3:
// verified   -- source actually opened & read this session, URL/DOI in references.bib
// estimated  -- inferred from family-typical ranges, not a direct measurement
// placeholder -- not yet researched
// not_applicable -- property doesn't exist for this material (never conflate with placeholder)
export const statusEnum = z.enum(['verified', 'placeholder', 'estimated', 'not_applicable']);
export const evidenceLevelEnum = z.enum(['peer-reviewed', 'handbook', 'datasheet', 'tertiary']);

// A citation is only meaningful once something has actually been researched.
// `placeholder` (not yet researched) and `not_applicable` (property doesn't
// exist for this material) legitimately have nothing to cite; `verified`
// and `estimated` must always point to a references.bib key.
const requireSourceUnlessUnresearched = (
  data: { source?: string; status: z.infer<typeof statusEnum> },
  ctx: z.RefinementCtx
) => {
  const needsSource = data.status === 'verified' || data.status === 'estimated';
  if (needsSource && !data.source) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `source is required when status is "${data.status}"`,
      path: ['source'],
    });
  }
};

// Every numeric/empirical property value is one of these -- never a bare number.
export const propertyValueSchema = z
  .object({
    value: z.number().nullable(),
    range_min: z.number().optional(),
    range_max: z.number().optional(),
    unit: z.string(),
    conditions: z.string().optional(),
    test_standard: z.string().optional(),
    source: z.string().optional(), // citation key into references.bib
    evidence_level: evidenceLevelEnum.optional(),
    status: statusEnum,
  })
  .superRefine(requireSourceUnlessUnresearched);
export type PropertyValue = z.infer<typeof propertyValueSchema>;

// Same provenance/status discipline as propertyValueSchema, for empirical
// properties that are categorical rather than numeric (UL94 flammability
// rating, solvent-resistance ratings, etc.) -- not explicitly named in
// instructions.md §3.3's PropertyValue code block (which is number-typed),
// but the "never a bare value, always cited + statused" rule clearly extends
// to these too.
export const ratedValueSchema = z
  .object({
    value: z.string().nullable(),
    conditions: z.string().optional(),
    test_standard: z.string().optional(),
    source: z.string().optional(),
    evidence_level: evidenceLevelEnum.optional(),
    status: statusEnum,
  })
  .superRefine(requireSourceUnlessUnresearched);
export type RatedValue = z.infer<typeof ratedValueSchema>;

// Shared structured image object (§3.3 Media block) -- every image field
// site-wide uses this, never a bare path.
export const imageObjectSchema = z.object({
  src: z.string(),
  alt: z.string(),
  caption: z.string().optional(),
  source_url: z.string(),
  author: z.string(),
  license: z.string(),
  attribution_text: z.string().optional(),
});
export type ImageObject = z.infer<typeof imageObjectSchema>;

// §5.2: structure imagery additionally records ChemDraw provenance.
export const structureImageSchema = imageObjectSchema.extend({
  tool: z.literal('ChemDraw'),
  generated_date: z.string(), // ISO date
});

export const aliasSchema = z.object({
  name: z.string(),
  autolinkable: z.boolean().default(true),
});

export const monomerRefSchema = z.object({
  name: z.string(),
  wikipedia_url: z.string(),
});

export const applicationSchema = z.object({
  sector: z.string(),
  examples: z.array(z.string()),
  notes: z.string().optional(),
});
