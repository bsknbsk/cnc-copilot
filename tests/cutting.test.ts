import { describe, it, expect } from 'vitest';
import { calculateCutting } from '../src/engine/cutting.js';
import { MATERIALS } from '../src/engine/materials.js';

function expectWithin1Percent(actual: number, expected: number) {
  const diff = Math.abs(actual - expected);
  const maxAllowed = Math.abs(expected) * 0.01;
  expect(diff).toBeLessThanOrEqual(maxAllowed);
}

describe('Cutting Engine Physics Verification (src/engine/cutting.ts)', () => {
  it('Milling D 10, Vc 314.16, z 4, fz 0.05, ap 10, ae 5: n 10,000 rpm, vf 2,000 mm/min, Q 100 cm3/min', () => {
    const results = calculateCutting({
      process: 'milling',
      material: MATERIALS.al6061,
      toolMaterial: 'carbide',
      diameter: 10,
      vc: 314.16,
      flutes: 4,
      feed: 0.05,
      ap: 10,
      ae: 5,
      machineMaxKw: 15,
    });

    expectWithin1Percent(results.rpm, 10000);
    expectWithin1Percent(results.feedRate, 2000);
    expectWithin1Percent(results.mrr, 100);
  });

  it('Turning D 50, Vc 200, fn 0.2, ap 2, r 0.8: n 1,273 rpm, Q 80 cm3/min, Ra 6.25 micrometre', () => {
    const results = calculateCutting({
      process: 'turning',
      material: MATERIALS.steel1045,
      toolMaterial: 'carbide',
      diameter: 50,
      vc: 200,
      flutes: 1,
      feed: 0.2,
      ap: 2,
      noseRadius: 0.8,
      machineMaxKw: 15,
    });

    expectWithin1Percent(results.rpm, 1273);
    expectWithin1Percent(results.mrr, 80);
    expect(results.raUm).toBeDefined();
    expectWithin1Percent(results.raUm!, 6.25);
  });

  it('Drilling D 10, Vc 100, fn 0.2: n 3,183 rpm, vf 637 mm/min, Q 50 cm3/min', () => {
    const results = calculateCutting({
      process: 'drilling',
      material: MATERIALS.al6061,
      toolMaterial: 'carbide',
      diameter: 10,
      vc: 100,
      flutes: 2,
      feed: 0.2,
      machineMaxKw: 15,
    });

    expectWithin1Percent(results.rpm, 3183);
    expectWithin1Percent(results.feedRate, 637);
    expectWithin1Percent(results.mrr, 50);
  });

  it('Tapping M10 x 1.5 at 500 rpm: vf 750 mm/min, cutting tap drill 8.5, forming 9.25', () => {
    // Vc corresponding to 500 RPM for 10mm diameter: Vc = (500 * pi * 10) / 1000 = 5 * pi m/min
    const vcFor500Rpm = (500 * Math.PI * 10) / 1000;

    const cuttingTap = calculateCutting({
      process: 'tapping',
      material: MATERIALS.steel1045,
      toolMaterial: 'hss',
      diameter: 10,
      vc: vcFor500Rpm,
      flutes: 3,
      feed: 1.5,
      tapType: 'cutting',
      machineMaxKw: 15,
    });

    const formingTap = calculateCutting({
      process: 'tapping',
      material: MATERIALS.steel1045,
      toolMaterial: 'hss',
      diameter: 10,
      vc: vcFor500Rpm,
      flutes: 3,
      feed: 1.5,
      tapType: 'forming',
      machineMaxKw: 15,
    });

    expectWithin1Percent(cuttingTap.rpm, 500);
    expectWithin1Percent(cuttingTap.feedRate, 750);
    expect(cuttingTap.tapDrillMm).toBeDefined();
    expectWithin1Percent(cuttingTap.tapDrillMm!, 8.5);

    expect(formingTap.tapDrillMm).toBeDefined();
    expectWithin1Percent(formingTap.tapDrillMm!, 9.25);
  });

  it('Power zones: 69% green, 75% amber, 95% red', () => {
    const ap = 5;
    const ae = 5;
    const feedRate = 2000;
    const eta = 0.8;
    const kc1 = MATERIALS.steel1045.kc1;
    const mc = MATERIALS.steel1045.mc;
    const h = 0.05 * Math.sqrt(5 / 10);
    const kc = kc1 * Math.pow(h, -mc);
    const powerKw = (ap * ae * feedRate * kc) / (60 * 1000000 * eta);

    const baseParams = {
      process: 'milling' as const,
      material: MATERIALS.steel1045,
      toolMaterial: 'carbide' as const,
      diameter: 10,
      vc: 314.16,
      flutes: 4,
      feed: 0.05,
      ap: 5,
      ae: 5,
    };

    const res69 = calculateCutting({
      ...baseParams,
      machineMaxKw: powerKw / 0.69,
    });

    const res75 = calculateCutting({
      ...baseParams,
      machineMaxKw: powerKw / 0.75,
    });

    const res95 = calculateCutting({
      ...baseParams,
      machineMaxKw: powerKw / 0.95,
    });

    expectWithin1Percent(res69.powerPercent, 69);
    expect(res69.powerZone).toBe('green');

    expectWithin1Percent(res75.powerPercent, 75);
    expect(res75.powerZone).toBe('amber');

    expectWithin1Percent(res95.powerPercent, 95);
    expect(res95.powerZone).toBe('red');
  });
});
