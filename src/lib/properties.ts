// The polymer property catalogue: every single-valued property in the data
// schema, with the label a reader sees and where it lives in a data file.
// The entry pages' data blocks and the Compare tool both read their rows from
// here, so a property is named, ordered and located in exactly one place.
//
// Per-solvent and per-gas properties (solvent resistance, gas permeability,
// chi, Mark-Houwink) have one row per key and are not listed here.
import type { PolymerData } from './content';

type Numeric = PolymerData['physical']['density'];
type Rated = PolymerData['chemical_resistance']['weathering_uv'];

export interface NumericProp {
  key: string;
  label: string;
  get: (d: PolymerData) => Numeric | null;
  /** Worth plotting against other polymers. Off for scales that do not
   *  share one axis (hardness is reported on several) and for categorical
   *  ratings that happen to be numbers (the NFPA 0-4 scores). */
  chartable: boolean;
}
export interface RatedProp {
  key: string;
  label: string;
  get: (d: PolymerData) => Rated;
}

const n = (
  key: string,
  label: string,
  get: NumericProp['get'],
  chartable = true
): NumericProp => ({ key, label, get, chartable });

export const NUMERIC = {
  physical: [
    n('density', 'Density', (d) => d.physical.density),
    n('melt_flow_index', 'Melt flow index', (d) => d.physical.melt_flow_index),
    n('refractive_index', 'Refractive index', (d) => d.physical.refractive_index),
    n('transmittance', 'Transmittance', (d) => d.physical.transmittance),
    n('haze', 'Haze', (d) => d.physical.haze),
    n('gloss', 'Gloss', (d) => d.physical.gloss),
    n('water_absorption', 'Water absorption', (d) => d.physical.water_absorption),
    n('dielectric_constant', 'Dielectric constant', (d) => d.physical.dielectric_constant),
    n('dielectric_strength', 'Dielectric strength', (d) => d.physical.dielectric_strength),
    n(
      'electrical_conductivity',
      'Electrical conductivity',
      (d) => d.physical.electrical_conductivity
    ),
  ],
  thermal: [
    n('tg', 'Glass transition (Tg)', (d) => d.thermal.tg),
    n('tm', 'Melting temperature (Tm)', (d) => d.thermal.tm),
    n('tc', 'Crystallization (Tc)', (d) => d.thermal.tc),
    n('hdt', 'Heat deflection (HDT)', (d) => d.thermal.hdt),
    n('decomposition_onset', 'Decomposition onset', (d) => d.thermal.decomposition_onset),
    n('thermal_conductivity', 'Thermal conductivity', (d) => d.thermal.thermal_conductivity),
  ],
  mechanical: [
    n('tensile_modulus', 'Tensile modulus', (d) => d.mechanical.tensile_modulus),
    n('yield_strength', 'Yield strength', (d) => d.mechanical.yield_strength),
    n(
      'tensile_strength_at_break',
      'Tensile strength at break',
      (d) => d.mechanical.tensile_strength_at_break
    ),
    n('elongation_at_break', 'Elongation at break', (d) => d.mechanical.elongation_at_break),
    n('impact_izod', 'Impact strength (Izod)', (d) => d.mechanical.impact_izod),
    n('impact_charpy', 'Impact strength (Charpy)', (d) => d.mechanical.impact_charpy),
    n('hardness', 'Hardness', (d) => d.mechanical.hardness, false),
    n('flexural_modulus', 'Flexural modulus', (d) => d.mechanical.flexural_modulus),
    n('poissons_ratio', "Poisson's ratio", (d) => d.mechanical.poissons_ratio),
    n(
      'coefficient_of_friction',
      'Coefficient of friction',
      (d) => d.mechanical.coefficient_of_friction
    ),
  ],
  resistance: [
    n(
      'limiting_oxygen_index',
      'Limiting oxygen index',
      (d) => d.chemical_resistance.limiting_oxygen_index
    ),
    n(
      'solubility_parameter',
      'Solubility parameter (δ)',
      (d) => d.chemical_resistance.solubility_parameter
    ),
  ],
  processing: [
    n(
      'processing_temp_range',
      'Processing temperature',
      (d) => d.processing.processing_temp_range
    ),
    n('shrinkage_rate', 'Shrinkage rate', (d) => d.processing.shrinkage_rate),
  ],
  toxicity: [
    n('ld50_oral_rat', 'LD50 (oral, rat)', (d) => d.toxicity_safety.ld50_oral_rat),
    n('nfpa_health', 'NFPA health', (d) => d.toxicity_safety.nfpa_health_rating, false),
    n(
      'nfpa_flammability',
      'NFPA flammability',
      (d) => d.toxicity_safety.nfpa_flammability_rating,
      false
    ),
    n(
      'nfpa_reactivity',
      'NFPA reactivity',
      (d) => d.toxicity_safety.nfpa_reactivity_rating,
      false
    ),
  ],
  molecularWeight: [
    n('mn', 'Number average (Mn)', (d) => d.structure_morphology.molecular_weight.mn),
    n('mw', 'Mass average (Mw)', (d) => d.structure_morphology.molecular_weight.mw),
    n('pdi', 'Dispersity (Mw/Mn)', (d) => d.structure_morphology.molecular_weight.pdi),
  ],
  morphology: [
    n(
      'crystallinity',
      'Typical crystallinity',
      (d) => d.structure_morphology.crystallinity_typical
    ),
  ],
} satisfies Record<string, NumericProp[]>;

export const RATED = {
  resistance: [
    { key: 'weathering_uv', label: 'Weathering / UV', get: (d) => d.chemical_resistance.weathering_uv },
    {
      key: 'hydrolysis_resistance',
      label: 'Hydrolysis resistance',
      get: (d) => d.chemical_resistance.hydrolysis_resistance,
    },
    {
      key: 'flammability_ul94',
      label: 'Flammability (UL94)',
      get: (d) => d.chemical_resistance.flammability_ul94,
    },
  ],
  toxicity: [
    {
      key: 'carcinogenic_classification',
      label: 'Carcinogenic classification',
      get: (d) => d.toxicity_safety.carcinogenic_classification,
    },
  ],
} satisfies Record<string, RatedProp[]>;
