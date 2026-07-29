import { z } from 'astro/zod';
import erasData from '../data/taxonomy/eras.json';
import {
  propertyValueSchema,
  ratedValueSchema,
  imageObjectSchema,
  structureImageSchema,
  aliasSchema,
  monomerRefSchema,
  applicationSchema,
  chemicalFamilyEnum,
  backboneClassEnum,
  polymerizationMechanismEnum,
  keyedPropertyArraySchema,
  markHouwinkArraySchema,
} from './schema-shared';

const eraNames = erasData.map((e) => e.name) as [string, ...string[]];

// One configurational form of a repeat unit -- cis vs trans 1,4-addition,
// 1,2-vinyl addition, a defined stereocentre. Same constitution, different
// geometry, and often a different material: cis-1,4-polyisoprene is rubber
// while the trans isomer is gutta-percha. Entries with no meaningful
// alternative leave this empty and the top-level repeat_unit stands alone.
const structureVariantSchema = z.object({
  key: z.string(), // asset suffix, e.g. 'trans-1-4' -> <id>--trans-1-4.svg
  label: z.string(), // as shown to a reader, e.g. 'trans-1,4'
  repeat_unit: z.string().nullable(), // BigSMILES
  smiles_depiction: z.string().nullable(), // plain SMILES, '*' attachment points
  note: z.string().optional(),
  is_default: z.boolean().default(false), // the form the page opens on
});

// Full polymer data schema, all 14 blocks. Lives in a separate data
// collection from the narrative MDX (two files per entry, never merged),
// joined by `id`. Concepts get their own lighter data schema -- this one
// is polymer_hub / polymer_variant only.
export const polymerDataSchema = z.object({
  // 1. Identity
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  abbreviation: z.array(z.string()).default([]),
  type: z.enum(['hub', 'variant']),
  parent: z.string().nullable().default(null),
  cas_number: z.string().nullable(),
  resin_id_code: z.string().nullable(),
  repeat_unit: z.string().nullable(), // BigSMILES
  // Plain SMILES for the same repeat unit, attachment points written as '*'.
  // Derived from `repeat_unit`, for tooling that cannot read BigSMILES.
  smiles_depiction: z.string().nullable().default(null),
  // Alternative configurations of that same repeat unit, if the polymer has
  // any. repeat_unit above is always the default one, repeated here as the
  // entry marked is_default.
  structure_variants: z.array(structureVariantSchema).default([]),
  notation_note: z.string().optional(), // required in spirit when repeat_unit is null
  iupac_name: z.string().nullable(),
  synonyms: z.array(z.string()).default([]),
  aliases: z.array(aliasSchema).default([]),

  // 2. Classification
  chemical_family: z.array(z.enum(chemicalFamilyEnum)).default([]),
  backbone_class: z.enum(backboneClassEnum).nullable(),
  polymerization_mechanism: z.array(z.enum(polymerizationMechanismEnum)).default([]),
  monomer: z.array(monomerRefSchema).default([]),
  polymer_class: z.enum(['thermoplastic', 'thermoset', 'elastomer']).nullable(),

  // 3. History hook (history_narrative itself lives in the paired MDX file)
  year_of_origin: z.number(),
  era: z.enum(eraNames),
  key_figures: z.array(z.string()).default([]),
  historical_events_referenced: z.array(z.string()).default([]),
  historical_images: z.array(imageObjectSchema).default([]),

  // 4. Synthesis
  synthesis: z.object({
    polymerization_type: z.string().nullable(),
    common_monomers: z.array(z.string()).default([]),
    catalysts: z.array(z.string()).default([]),
    industrial_process_notes: z.string().nullable(),
    synthesis_scheme_image: imageObjectSchema.nullable().default(null),
  }),

  // 5. Structure & morphology
  structure_morphology: z.object({
    tacticity: z.string().nullable(),
    crystallinity_typical: propertyValueSchema.nullable(),
    crystal_structure: z.string().nullable(),
    chain_flexibility_notes: z.string().nullable(),
    tg_relation_notes: z.string().nullable(),
    // Typical commercial/reported molecular weight -- almost every handbook
    // entry carries these three together; PDI (Mw/Mn) is dimensionless.
    molecular_weight: z.object({
      mn: propertyValueSchema,
      mw: propertyValueSchema,
      pdi: propertyValueSchema,
    }),
    // Viscosity-molecular weight relationship [eta] = K * M^a. Solvent-
    // dependent by nature (see keyedPropertyArraySchema doc) -- K and a are
    // paired per solvent, never meaningful alone.
    mark_houwink: markHouwinkArraySchema,
  }),

  // 5b. Physical properties — density plus a few bulk properties that fit
  // none of the other blocks (several are fine to leave placeholder).
  physical: z.object({
    density: propertyValueSchema,
    melt_flow_index: propertyValueSchema,
    refractive_index: propertyValueSchema,
    dielectric_constant: propertyValueSchema,
    // Conducting polymers (polyaniline, polythiophene) have no other home
    // for their defining property. Use `conditions` for doping state, since
    // conductivity swings by orders of magnitude between doped/undoped forms.
    electrical_conductivity: propertyValueSchema,
    // Optical clarity -- relevant mainly for transparent/semi-transparent
    // grades (PET, PC, PMMA, PS); note test geometry (e.g. specimen
    // thickness, gloss angle) in `conditions`.
    transmittance: propertyValueSchema,
    haze: propertyValueSchema,
    gloss: propertyValueSchema,
    // Equilibrium water/moisture uptake -- note immersion vs. RH-equilibrium
    // conditions, since the two give very different numbers.
    water_absorption: propertyValueSchema,
    // Dielectric breakdown strength -- distinct from dielectric_constant
    // (permittivity) above; note specimen thickness in `conditions`, since
    // breakdown strength is thickness-dependent.
    dielectric_strength: propertyValueSchema,
  }),

  // 6. Thermal properties
  thermal: z.object({
    tg: propertyValueSchema,
    tm: propertyValueSchema,
    tc: propertyValueSchema,
    hdt: propertyValueSchema,
    decomposition_onset: propertyValueSchema,
    thermal_conductivity: propertyValueSchema,
  }),

  // 7. Mechanical properties
  mechanical: z.object({
    tensile_modulus: propertyValueSchema,
    yield_strength: propertyValueSchema,
    // Deliberately distinct from yield_strength -- many sources (esp.
    // Wikipedia infoboxes) report unqualified "tensile strength," which for
    // brittle/amorphous thermoplastics and elastomers (no distinct yield
    // region before failure) means strength at break, not a true yield
    // point. Conflating the two is a real mislabeling hazard.
    tensile_strength_at_break: propertyValueSchema,
    elongation_at_break: propertyValueSchema,
    impact_izod: propertyValueSchema,
    impact_charpy: propertyValueSchema,
    hardness: propertyValueSchema,
    flexural_modulus: propertyValueSchema,
    // Dimensionless elastic constant; note counter-surface/test method
    // (e.g. steel vs. steel, dry vs. lubricated) in `conditions`.
    poissons_ratio: propertyValueSchema,
    coefficient_of_friction: propertyValueSchema,
  }),

  // 8. Chemical / environmental resistance
  chemical_resistance: z.object({
    solvent_resistance: z.record(z.string(), ratedValueSchema).default({}),
    weathering_uv: ratedValueSchema,
    hydrolysis_resistance: ratedValueSchema,
    flammability_ul94: ratedValueSchema,
    // Limiting oxygen index -- numeric flammability metric alongside the
    // categorical UL94 rating above.
    limiting_oxygen_index: propertyValueSchema,
    // Hildebrand solubility parameter -- a single value predicting solvent
    // miscibility, distinct from the per-solvent good/poor ratings above.
    solubility_parameter: propertyValueSchema,
    // Flory-Huggins polymer-solvent interaction parameter, one value per
    // solvent (never a single representative number -- see
    // keyedPropertyArraySchema doc in schema-shared.ts). `key` = solvent name.
    interaction_parameter_chi: keyedPropertyArraySchema,
    // Gas/vapor barrier performance, one value per permeant species (O2,
    // CO2, N2, H2O...) -- critical for packaging polymers. `key` = gas name.
    gas_permeability: keyedPropertyArraySchema,
  }),

  // 9. Processing
  processing: z.object({
    processing_methods: z.array(z.string()).default([]),
    processing_temp_range: propertyValueSchema,
    drying_required: z.boolean().nullable(),
    shrinkage_rate: propertyValueSchema,
  }),

  // 10. Applications
  applications: z.array(applicationSchema).default([]),

  // 11. Environmental & recycling
  environmental: z.object({
    recyclable: z.boolean().nullable(),
    biodegradable: z.boolean().nullable(),
    degradation_pathway: z.string().nullable(),
    environmental_notes: z.string().nullable(),
  }),

  // 12. References
  references: z.array(z.string()).default([]), // citation keys into references.bib

  // 13. Media
  media: z.object({
    hero_image: imageObjectSchema.nullable().default(null),
    diagrams: z.array(imageObjectSchema).default([]),
    structure_render_2d: structureImageSchema.nullable().default(null),
    structure_render_3d: structureImageSchema.nullable().default(null),
  }),

  // 14. Toxicity & safety -- acute toxicity and fire-hazard ratings are
  // commonly reported alongside other bulk properties and had no home
  // anywhere else in this schema.
  toxicity_safety: z.object({
    ld50_oral_rat: propertyValueSchema, // acute oral toxicity, rat model
    // NFPA 704 diamond ratings, each 0-4.
    nfpa_health_rating: propertyValueSchema,
    nfpa_flammability_rating: propertyValueSchema,
    nfpa_reactivity_rating: propertyValueSchema,
    // Categorical (e.g. an IARC group, or "not listed by ACGIH/NIOSH/NTP") --
    // never a bare unqualified value, same discipline as ratedValueSchema
    // elsewhere.
    carcinogenic_classification: ratedValueSchema,
    safety_notes: z.string().nullable(),
  }),
});

export type PolymerData = z.infer<typeof polymerDataSchema>;
