import { z } from 'astro/zod';
import chemicalFamilies from '../data/taxonomy/chemical-families.json';
import backboneClasses from '../data/taxonomy/backbone-classes.json';
import polymerizationMechanisms from '../data/taxonomy/polymerization-mechanisms.json';

export const chemicalFamilyEnum = chemicalFamilies as [string, ...string[]];
export const backboneClassEnum = backboneClasses as [string, ...string[]];
export const polymerizationMechanismEnum = polymerizationMechanisms as [string, ...string[]];

// Status semantics for every empirical value on the site:
// verified   -- source actually opened & read, URL/DOI in references.bib
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
      code: 'custom',
      message: `source is required when status is "${data.status}"`,
      path: ['source'],
    });
  }
};

// Every numeric/empirical property value is one of these -- never a bare number.
const propertyValueShape = {
  value: z.number().nullable(),
  range_min: z.number().optional(),
  range_max: z.number().optional(),
  unit: z.string(),
  conditions: z.string().optional(),
  test_standard: z.string().optional(),
  source: z.string().optional(), // citation key into references.bib
  evidence_level: evidenceLevelEnum.optional(),
  status: statusEnum,
};
const propertyValueObject = z.object(propertyValueShape);
export const propertyValueSchema = propertyValueObject.superRefine(requireSourceUnlessUnresearched);
export type PropertyValue = z.infer<typeof propertyValueSchema>;

// Some properties legitimately have many values rather than one
// representative number -- Mark-Houwink K/a per solvent, gas permeability
// per gas species, polymer-solvent interaction parameter (chi) per solvent.
// Rather than a bespoke shape per property, this is the same value object
// plus a `key` naming the distinguishing dimension (solvent/gas name), so
// every entry keeps its own independent provenance and status -- one grade's
// placeholder doesn't force the whole table to placeholder.
const keyedPropertyValueObject = propertyValueObject.extend({ key: z.string() });
export const keyedPropertyValueSchema = keyedPropertyValueObject.superRefine(
  requireSourceUnlessUnresearched
);
export type KeyedPropertyValue = z.infer<typeof keyedPropertyValueSchema>;
export const keyedPropertyArraySchema = z.array(keyedPropertyValueSchema).default([]);

// Mark-Houwink K and a are always reported as a pair for a given solvent (and
// often a temperature/MW range) -- neither number means anything alone, so
// this pairs them under one solvent entry instead of forcing two independent
// keyed arrays a reader would have to cross-reference by hand.
export const markHouwinkEntrySchema = z.object({
  solvent: z.string(),
  temperature_k: z.number().nullable().optional(),
  mw_range: z.string().optional(), // free text, e.g. "70-1,800 kg/mol"
  k: propertyValueSchema,
  a: propertyValueSchema,
});
export type MarkHouwinkEntry = z.infer<typeof markHouwinkEntrySchema>;
export const markHouwinkArraySchema = z.array(markHouwinkEntrySchema).default([]);

// Same provenance/status discipline as propertyValueSchema, for empirical
// properties that are categorical rather than numeric (UL94 flammability
// rating, solvent-resistance ratings, etc.) -- the "never a bare value,
// always cited + statused" rule extends to these too.
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

// Shared structured image object -- every image field site-wide uses this,
// never a bare path (license + attribution always recorded).
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

// Structure imagery additionally records drawing-tool provenance.
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
