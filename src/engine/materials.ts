export interface ToolSpeedRange {
  min: number;
  max: number;
}

export interface MaterialSpec {
  id: string;
  name: string;
  isoGroup: string;
  isoClass: 'P' | 'M' | 'K' | 'N' | 'S' | 'H';
  hardness: string;
  yieldMpa: number;
  kc1: number; // N/mm^2 specific cutting force at h = 1mm
  mc: number;  // chip thickness exponent
  carbide: {
    vc: ToolSpeedRange;
    fz: { min: number; max: number };
  };
  hss: {
    vc: ToolSpeedRange;
    fz: { min: number; max: number };
  };
  note: string;
}

export const MATERIALS: Record<string, MaterialSpec> = {
  al6061: {
    id: 'al6061',
    name: 'Aluminium 6061-T6',
    isoGroup: 'ISO N: Non-Ferrous',
    isoClass: 'N',
    hardness: '95 HB',
    yieldMpa: 276,
    kc1: 700,
    mc: 0.25,
    carbide: {
      vc: { min: 300, max: 600 },
      fz: { min: 0.05, max: 0.20 },
    },
    hss: {
      vc: { min: 80, max: 120 },
      fz: { min: 0.05, max: 0.20 },
    },
    note: 'Free machining aerospace aluminium alloy. High thermal conductivity.',
  },
  steel1045: {
    id: 'steel1045',
    name: 'Medium Carbon Steel 1045',
    isoGroup: 'ISO P: Carbon Steel',
    isoClass: 'P',
    hardness: '180 HB',
    yieldMpa: 310,
    kc1: 1700,
    mc: 0.25,
    carbide: {
      vc: { min: 180, max: 250 },
      fz: { min: 0.05, max: 0.15 },
    },
    hss: {
      vc: { min: 25, max: 35 },
      fz: { min: 0.05, max: 0.15 },
    },
    note: 'General engineering steel, predictable chip breaking behavior.',
  },
  steel4140: {
    id: 'steel4140',
    name: 'Alloy Steel 4140 (Cr-Mo)',
    isoGroup: 'ISO P: Alloy Steel',
    isoClass: 'P',
    hardness: '280 HB',
    yieldMpa: 655,
    kc1: 1950,
    mc: 0.25,
    carbide: {
      vc: { min: 150, max: 220 },
      fz: { min: 0.05, max: 0.12 },
    },
    hss: {
      vc: { min: 18, max: 28 },
      fz: { min: 0.05, max: 0.12 },
    },
    note: 'Tough, pre-hardened chrome-moly steel. Requires rigid tooling setup.',
  },
  ss304: {
    id: 'ss304',
    name: 'Stainless Steel 304 (Austenitic)',
    isoGroup: 'ISO M: Stainless Steel',
    isoClass: 'M',
    hardness: '190 HB',
    yieldMpa: 215,
    kc1: 2000,
    mc: 0.21,
    carbide: {
      vc: { min: 120, max: 180 },
      fz: { min: 0.04, max: 0.10 },
    },
    hss: {
      vc: { min: 12, max: 20 },
      fz: { min: 0.04, max: 0.10 },
    },
    note: 'Work-hardening tendency. Never dwell or rub; maintain positive feed.',
  },
  ti6al4v: {
    id: 'ti6al4v',
    name: 'Titanium Ti-6Al-4V (Grade 5)',
    isoGroup: 'ISO S: Superalloys & Titanium',
    isoClass: 'S',
    hardness: '36 HRC',
    yieldMpa: 880,
    kc1: 1400,
    mc: 0.23,
    carbide: {
      vc: { min: 40, max: 70 },
      fz: { min: 0.03, max: 0.08 },
    },
    hss: {
      vc: { min: 6, max: 10 },
      fz: { min: 0.03, max: 0.08 },
    },
    note: 'Low thermal conductivity. Generates high heat at the cutting edge. Flood coolant mandatory.',
  },
  castiron: {
    id: 'castiron',
    name: 'Grey Cast Iron (GG25)',
    isoGroup: 'ISO K: Cast Iron',
    isoClass: 'K',
    hardness: '210 HB',
    yieldMpa: 250,
    kc1: 1100,
    mc: 0.28,
    carbide: {
      vc: { min: 150, max: 250 },
      fz: { min: 0.08, max: 0.20 },
    },
    hss: {
      vc: { min: 20, max: 30 },
      fz: { min: 0.08, max: 0.20 },
    },
    note: 'Discontinuous abrasive chips. Can be cut dry or with compressed air.',
  },
  brass: {
    id: 'brass',
    name: 'Free Cutting Brass (C36000)',
    isoGroup: 'ISO N: Non-Ferrous',
    isoClass: 'N',
    hardness: '130 HB',
    yieldMpa: 310,
    kc1: 700,
    mc: 0.25,
    carbide: {
      vc: { min: 200, max: 400 },
      fz: { min: 0.05, max: 0.20 },
    },
    hss: {
      vc: { min: 60, max: 90 },
      fz: { min: 0.05, max: 0.20 },
    },
    note: 'High machinability, low tool wear. Excellent surface finish.',
  },
};
