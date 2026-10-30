// Tunables: proposed unless labelled with evidence below; a host overrides them from its own data.

// decayPerDay is retained for compatibility only; decay uses the material class and band spans.
export interface ConditionBand { name: string; min: number; decayPerDay: number; outputFactor: number }

export interface SettlementConfig {
  bands: ConditionBand[]          // descending by min
  decayClasses: Record<string, { yearsToRuin: number | null; label: string; source: string }>
  exposure: Record<string, number | null>
  decayShares: Record<string, number> // proposed, level-5 band shape (VALIDATION section 4b)
  freeLayout: boolean             // may a title holder setLayout without a project (Q8; default no)
  hoursPerDay: number             // a full post's day, for labour arithmetic
  labourSharing: string          // proposed: in-order until Rex answers Q15
  tickOrder: readonly string[]
}

export const TICK_ORDER = ['decay', 'projects', 'staffing', 'production', 'wages', 'publicWorks', 'expiry'] as const

export function defaultConfig(): SettlementConfig {
  return {
    bands: [
      { name: 'fine', min: 0.8, decayPerDay: 0.0005, outputFactor: 1 },
      { name: 'sound', min: 0.5, decayPerDay: 0.001, outputFactor: 0.9 },
      { name: 'poor', min: 0.2, decayPerDay: 0.002, outputFactor: 0.6 },
      { name: 'ruined', min: 0, decayPerDay: 0, outputFactor: 0 },
    ],
    // Interim DUP-9 model (R-2): roof service life stands in for years to ruin; level 5.
    decayClasses: {
      'palm-thatch': { yearsToRuin: 5, label: 'estimate (secondary: an academic abstract, vendor and operator reports)', source: 'https://apccsec.org/journal-sub/index_php/journalicc/article/view/238' },
      'reed-thatch': { yearsToRuin: 25, label: 'estimate (secondary: insurer and property guides)', source: 'https://jensteninsurance.co.uk/how-long-does-a-thatched-roof-last/' },
      'wood-shingle': { yearsToRuin: 25, label: 'estimate (secondary, modern inspection charts)', source: 'https://www.nachi.org/life-expectancy.htm' },
      'tile-or-slate': { yearsToRuin: 50, label: 'estimate (secondary, modern charts)', source: 'https://www.nachi.org/florida-life-expectancy.htm' },
      masonry: { yearsToRuin: null, label: "flagged: the roof decides, and a masonry building's roof class must be given", source: 'https://vugradhistory.wordpress.com/2020/05/14/the-legacy-of-wattle-and-daub-homes-in-colonial-caribbean-architecture/' },
      'wattle-and-daub': { yearsToRuin: null, label: 'flagged: no rate under neglect', source: 'https://Buildingconservation.com/articles/wattleanddaub/wattleanddaub.htm' },
    },
    exposure: { sheltered: 1, 'salt-wind': null },
    decayShares: { fine: 400 / 850, sound: 300 / 850, poor: 150 / 850 },
    freeLayout: false,
    hoursPerDay: 10,
    labourSharing: 'in-order',
    tickOrder: TICK_ORDER,
  }
}

export function bandOf(config: SettlementConfig, condition: number): ConditionBand {
  const band = config.bands.find((entry) => condition >= entry.min)
  if (!band) throw new Error(`no condition band for ${condition}`)
  return band
}
