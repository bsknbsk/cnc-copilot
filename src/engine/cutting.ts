import { MaterialSpec } from './materials.js';

export type ProcessType = 'milling' | 'turning' | 'drilling' | 'tapping' | 'boring';
export type ToolMaterialType = 'carbide' | 'hss';
export type TapType = 'cutting' | 'forming';

export interface CuttingInputs {
  process: ProcessType;
  material: MaterialSpec;
  toolMaterial: ToolMaterialType;
  diameter: number; // D (mm)
  flutes: number;   // z (teeth)
  vc: number;       // Vc (m/min)
  feed: number;     // fz (mm/tooth) for milling, fn (mm/rev) for turning/drilling/boring, pitch P for tapping
  ap?: number;      // Axial depth of cut (mm)
  ae?: number;      // Radial width of cut (mm)
  depth?: number;   // Hole/cut length L (mm)
  machineMaxKw: number; // kW
  eta?: number;     // Spindle mechanical efficiency, default 0.8
  krDeg?: number;   // Tool lead angle for turning/boring, default 95 deg
  noseRadius?: number; // Tool nose radius r for turning/boring (mm), default 0.8
  pointAngleDeg?: number; // Drill point angle, default 140 deg
  overhang?: number; // Boring bar stickout (mm)
  tapType?: TapType; // Cutting or forming tap
  isImperial?: boolean; // For display formatting
}

export interface CuttingValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CuttingResults {
  process: ProcessType;
  rpm: number;           // n (RPM)
  feedRate: number;      // vf (mm/min)
  mrr: number;           // Q (cm3/min)
  powerKw: number;       // Pc (kW)
  torqueNm: number;      // Mc (Nm)
  powerPercent: number;  // Pc / machineMaxKw * 100
  powerZone: 'green' | 'amber' | 'red';
  chipThickness: number; // h or hm (mm)
  specificForce: number; // kc (N/mm2)
  tangentialForce: number; // Ft (N)

  // Process-specific outputs
  raUm?: number;         // Theoretical surface roughness Ra (micrometre) for turning/boring
  thrustForceN?: number; // Ff (N) for drilling
  cycleTimeMin?: number; // Cycle time (min) for turning/drilling/boring
  tapDrillMm?: number;   // Tap drill diameter (mm)
  gcodeBlock?: string[]; // G-code rigid tapping block
  validation: CuttingValidation;
}

export function validateCuttingInputs(inputs: CuttingInputs): CuttingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (inputs.diameter <= 0 || isNaN(inputs.diameter)) {
    errors.push('Tool diameter must be greater than 0 mm');
  }
  if (inputs.vc <= 0 || isNaN(inputs.vc)) {
    errors.push('Cutting speed (Vc) must be greater than 0 m/min');
  }
  if (inputs.feed <= 0 || isNaN(inputs.feed)) {
    errors.push('Feed must be greater than 0');
  }
  if (inputs.process === 'milling' && (!inputs.flutes || inputs.flutes < 1)) {
    errors.push('Number of flutes must be at least 1');
  }
  if (inputs.machineMaxKw <= 0) {
    errors.push('Machine spindle motor power must be greater than 0 kW');
  }

  // Check speed vs recommended band
  const rec = inputs.toolMaterial === 'carbide' ? inputs.material.carbide : inputs.material.hss;
  if (inputs.vc > rec.vc.max) {
    warnings.push(`Surface speed ${inputs.vc} m/min exceeds recommended ${inputs.toolMaterial.toUpperCase()} limit (${rec.vc.max} m/min) for ${inputs.material.name}. Increased tool wear/thermal breakdown risk.`);
  } else if (inputs.vc < rec.vc.min) {
    warnings.push(`Surface speed ${inputs.vc} m/min is below optimal range (${rec.vc.min}-${rec.vc.max} m/min). Risk of built-up edge (BUE).`);
  }

  // Process specific physical warnings
  if (inputs.process === 'boring') {
    const barDia = inputs.diameter;
    const overhang = inputs.overhang || inputs.depth || 50;
    if (overhang / barDia > 4) {
      warnings.push(`Overhang-to-diameter ratio is ${(overhang / barDia).toFixed(1)}xD (>4xD). Above 4xD use a damped bar or reduce Vc and ap to avoid severe chatter.`);
    }
  }

  if (inputs.process === 'drilling') {
    const depth = inputs.depth || 30;
    if (depth / inputs.diameter > 5) {
      warnings.push(`Hole depth is ${(depth / inputs.diameter).toFixed(1)}xD (>5xD). Use peck drilling cycle (G83) or a through-coolant drill to evacuate chips safely.`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export function calculateCutting(inputs: CuttingInputs): CuttingResults {
  const validation = validateCuttingInputs(inputs);
  if (!validation.isValid) {
    return {
      process: inputs.process,
      rpm: 0,
      feedRate: 0,
      mrr: 0,
      powerKw: 0,
      torqueNm: 0,
      powerPercent: 0,
      powerZone: 'green',
      chipThickness: 0,
      specificForce: 0,
      tangentialForce: 0,
      validation,
    };
  }

  const eta = inputs.eta ?? 0.8;
  const D = inputs.diameter;
  const Vc = inputs.vc;
  const kc1 = inputs.material.kc1;
  const mc = inputs.material.mc;

  // 1. Spindle speed n (rpm) = (1000 x Vc) / (pi x D)
  const rpm = Math.round((1000 * Vc) / (Math.PI * D));

  let feedRate = 0;      // vf (mm/min)
  let mrr = 0;           // Q (cm3/min)
  let h = 0.08;          // Chip thickness (mm)
  let powerKw = 0;       // Pc (kW)
  let raUm: number | undefined;
  let thrustForceN: number | undefined;
  let cycleTimeMin: number | undefined;
  let tapDrillMm: number | undefined;
  let gcodeBlock: string[] | undefined;

  switch (inputs.process) {
    case 'milling': {
      const z = inputs.flutes || 4;
      const fz = inputs.feed;
      const ap = inputs.ap ?? D;
      const ae = inputs.ae ?? (D * 0.4);

      // Feed rate vf = fz x z x n
      feedRate = Math.round(fz * z * rpm);

      // MRR Q (cm3/min) = (ap x ae x vf) / 1000
      mrr = Number(((ap * ae * feedRate) / 1000).toFixed(1));

      // Average chip thickness hm
      if (ae / D <= 0.5) {
        h = fz * Math.sqrt(ae / D);
      } else {
        h = fz;
      }
      h = Math.max(0.005, h);

      // kc (N/mm2) = kc1 x h^(-mc)
      const kc = kc1 * Math.pow(h, -mc);

      // Pc (kW) = (ap x ae x vf x kc) / (60 x 10^6 x eta)
      powerKw = (ap * ae * feedRate * kc) / (60 * 1000000 * eta);
      break;
    }

    case 'turning':
    case 'boring': {
      const fn = inputs.feed;
      const ap = inputs.ap ?? 2.0;
      const kr = (inputs.krDeg ?? 95) * (Math.PI / 180);
      const r = inputs.noseRadius ?? 0.8;
      const L = inputs.depth ?? 100;

      // vf = fn x n
      feedRate = Math.round(fn * rpm);

      // MRR Q = Vc x ap x fn
      mrr = Number((Vc * ap * fn).toFixed(1));

      // h = fn x sin(kr)
      h = Math.max(0.005, fn * Math.sin(kr));

      // kc = kc1 x h^(-mc)
      const kc = kc1 * Math.pow(h, -mc);

      // Pc = (Vc x ap x fn x kc) / (60 x 10^3 x eta)
      powerKw = (Vc * ap * fn * kc) / (60 * 1000 * eta);

      // Ra = (fn^2 / (8 x r)) x 1000
      raUm = Number(((Math.pow(fn, 2) / (8 * r)) * 1000).toFixed(2));

      // Cycle time = L / vf
      cycleTimeMin = feedRate > 0 ? Number((L / feedRate).toFixed(2)) : 0;
      break;
    }

    case 'drilling': {
      const fn = inputs.feed;
      const pointAngle = (inputs.pointAngleDeg ?? 140) * (Math.PI / 180);
      const L = inputs.depth ?? 40;

      feedRate = Math.round(fn * rpm);

      // Q = (Vc x D x fn) / 4
      mrr = Number(((Vc * D * fn) / 4).toFixed(1));

      // h = (fn / 2) x sin(pointAngle / 2)
      h = Math.max(0.005, (fn / 2) * Math.sin(pointAngle / 2));

      // kc = kc1 x h^(-mc)
      const kc = kc1 * Math.pow(h, -mc);

      // Pc = (fn x Vc x D x kc) / (240 x 10^3 x eta)
      powerKw = (fn * Vc * D * kc) / (240 * 1000 * eta);

      // Thrust Ff (N) ~ 0.5 x kc x (D / 2) x fn x sin(pointAngle / 2)
      thrustForceN = Math.round(0.5 * kc * (D / 2) * fn * Math.sin(pointAngle / 2));

      cycleTimeMin = feedRate > 0 ? Number((L / feedRate).toFixed(2)) : 0;
      break;
    }

    case 'tapping': {
      const pitch = inputs.feed; // Thread pitch P
      const tapType = inputs.tapType ?? 'cutting';
      const L = inputs.depth ?? 20;

      // vf = P x n
      feedRate = Math.round(pitch * rpm);

      // Tap drill: cutting = D - P, forming = D - 0.5 x P
      tapDrillMm = tapType === 'cutting' ? Number((D - pitch).toFixed(2)) : Number((D - 0.5 * pitch).toFixed(2));

      // Equivalent chip thickness for thread flank
      h = Math.max(0.01, pitch * 0.15);
      const kc = kc1 * Math.pow(h, -mc);

      // Power Pc estimation for tapping
      powerKw = ((D * pitch * feedRate * kc) / (200 * 1000000 * eta));
      mrr = Number(((Math.PI * Math.pow(D / 2, 2) * feedRate) / 1000).toFixed(1));

      // Fanuc rigid tapping block: "M29 S{n}" then "G84 Z-{L} R2.0 F{vf}"
      gcodeBlock = [
        `M29 S${rpm}`,
        `G84 Z-${L.toFixed(1)} R2.0 F${feedRate}`,
      ];
      break;
    }
  }

  // Torque Mc (Nm) = (Pc x 30000) / (pi x n)
  const torqueNm = rpm > 0 ? Number(((powerKw * 30000) / (Math.PI * rpm)).toFixed(1)) : 0;

  // Tangential cutting force Ft = (Pc * 1000 * 60) / Vc
  const tangentialForce = Vc > 0 ? Math.round((powerKw * 60000) / Vc) : 0;

  // Specific force kc at h
  const specificForce = Math.round(kc1 * Math.pow(h, -mc));

  // Power percentage & color zone
  const powerPercent = Number(((powerKw / inputs.machineMaxKw) * 100).toFixed(1));
  let powerZone: 'green' | 'amber' | 'red' = 'green';
  if (powerPercent >= 90) {
    powerZone = 'red';
    validation.warnings.push(`Cutting power (${powerKw.toFixed(1)} kW) exceeds 90% of machine limit (${inputs.machineMaxKw} kW). Spindle stall / thermal overload risk.`);
  } else if (powerPercent >= 70) {
    powerZone = 'amber';
    validation.warnings.push(`Cutting power (${powerKw.toFixed(1)} kW) is between 70% and 90% of continuous duty rating. Monitor chip evacuation and spindle temperature.`);
  }

  return {
    process: inputs.process,
    rpm,
    feedRate,
    mrr,
    powerKw: Number(powerKw.toFixed(1)),
    torqueNm,
    powerPercent,
    powerZone,
    chipThickness: Number(h.toFixed(3)),
    specificForce,
    tangentialForce,
    raUm,
    thrustForceN,
    cycleTimeMin,
    tapDrillMm,
    gcodeBlock,
    validation,
  };
}
