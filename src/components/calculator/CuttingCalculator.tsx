import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { collection, addDoc } from 'firebase/firestore';
import { MATERIALS, MaterialSpec } from '../../engine/materials.js';
import { calculateCutting, ProcessType, ToolMaterialType, CuttingInputs, CuttingResults } from '../../engine/cutting.js';
import { Calculator3DView } from './Calculator3DView.js';
import { apiFetch, db } from '../../lib/firebase.js';
import { 
  PageHeader, 
  SectionHeader, 
  StatChip, 
  EmptyState 
} from '../ui/Headers.js';
import { Card } from '../ui/Layout.js';
import { Badge } from '../ui/Badge.js';
import { ButtonPrimary, ButtonSecondary } from '../ui/Button.js';
import { Tabs, Skeleton, ProgressBar, Drawer } from '../ui/Feedback.js';

export function CuttingCalculator() {
  const { user, profile } = useAuth();

  // Process mode
  const [process, setProcess] = useState<ProcessType>('milling');
  const [isMetric, setIsMetric] = useState(true);

  // Material selection
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('al6061');
  const material: MaterialSpec = MATERIALS[selectedMaterialId] || MATERIALS.al6061;

  // Tool material
  const [toolMaterial, setToolMaterial] = useState<ToolMaterialType>('carbide');

  // Parameters
  const [diameter, setDiameter] = useState<number>(10.0);
  const [flutes, setFlutes] = useState<number>(4);
  const [pitch, setPitch] = useState<number>(1.5);
  const [vc, setVc] = useState<number>(160);
  const [feed, setFeed] = useState<number>(0.08); // fz for milling, fn for turning/drilling
  const [ap, setAp] = useState<number>(15.0);
  const [ae, setAe] = useState<number>(4.0);
  const [holeDepth, setHoleDepth] = useState<number>(30.0);
  const [machineMaxKw, setMachineMaxKw] = useState<number>(15.0);
  const [maxSpindleRpm, setMaxSpindleRpm] = useState<number>(12000);

  // Material dropdown open state
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false);
  const [toolAssemblyOpen, setToolAssemblyOpen] = useState(false);

  // AI Explain Drawer state
  const [explainDrawerOpen, setExplainDrawerOpen] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [justCalculated, setJustCalculated] = useState(false);

  // Log calculation run to users/{uid}/activity
  const logCalculation = async () => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'activity'), {
        type: 'calc',
        title: `${diameter}mm ${toolMaterial.toUpperCase()} ${process.toUpperCase()}`,
        summary: `${process.toUpperCase()} ${diameter}mm in ${material.name} • ${results.rpm} RPM, ${results.powerKw} kW`,
        link: 'calculator',
        createdAt: new Date().toISOString(),
      });
      setJustCalculated(true);
      setTimeout(() => setJustCalculated(false), 2000);
    } catch (err) {
      console.warn('[CuttingCalculator] Activity write notice:', err);
    }
  };

  // Compute live physics results
  const inputs: CuttingInputs = useMemo(() => {
    return {
      process,
      material,
      toolMaterial,
      diameter,
      flutes: process === 'milling' ? flutes : 1,
      vc,
      feed: process === 'tapping' ? pitch : feed,
      ap: process === 'milling' || process === 'turning' || process === 'boring' ? ap : undefined,
      ae: process === 'milling' ? ae : undefined,
      depth: holeDepth,
      machineMaxKw,
      eta: 0.8,
      tapType: 'cutting',
    };
  }, [process, material, toolMaterial, diameter, flutes, pitch, vc, feed, ap, ae, holeDepth, machineMaxKw]);

  const results: CuttingResults = useMemo(() => {
    return calculateCutting(inputs);
  }, [inputs]);

  // Recommended speed band
  const recRange = toolMaterial === 'carbide' ? material.carbide.vc : material.hss.vc;
  const sliderMin = Math.max(10, Math.floor(recRange.min * 0.4));
  const sliderMax = Math.ceil(recRange.max * 1.5);

  // Unit conversion helpers
  const formatFeedRate = (mmMin: number) => {
    if (isMetric) return `${mmMin.toLocaleString()} mm/min`;
    return `${(mmMin / 25.4).toFixed(1)} IPM`;
  };

  const formatMrr = (cm3Min: number) => {
    if (isMetric) return `${cm3Min} cm³/min`;
    return `${(cm3Min / 16.387).toFixed(2)} in³/min`;
  };

  const formatTorque = (nm: number) => {
    if (isMetric) return `${nm} N·m`;
    return `${(nm * 0.73756).toFixed(1)} ft·lb`;
  };

  // Trigger Copilot Explain API
  const handleAskCopilot = async () => {
    setExplainDrawerOpen(true);
    setExplaining(true);
    setExplainError(null);
    setExplanation(null);
    logCalculation();

    try {
      const res = await apiFetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs,
          results,
          language: profile?.preferredLanguage || 'en',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to explain cutting parameters');
      }

      const data = await res.json();
      setExplanation(data.explanation);
    } catch (err: any) {
      console.error('[CuttingCalculator] Explain error:', err);
      setExplainError(err.message || 'Could not reach Copilot process engineer.');
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="w-full px-margin py-margin">
      <div className="flex flex-col w-full">
        {/* Header & Process Tabs */}
        <section className="w-full mb-space-lg">
          <PageHeader
            label="Kinematic Engine: Kienzle Force V4.2"
            title="Cutting Physics Calculator"
            caption="Optimize spindle RPM, chip load (fz), and cutting power with real-time physics."
            actions={
              <Tabs
                activeTab={process}
                onTabChange={(id) => {
                  setProcess(id as ProcessType);
                  if (id === 'milling') setFeed(0.08);
                  if (id === 'turning') setFeed(0.15);
                  if (id === 'drilling') setFeed(0.12);
                  if (id === 'tapping') { setPitch(1.5); setDiameter(10.0); }
                  if (id === 'boring') setFeed(0.12);
                }}
                tabs={[
                  { id: 'milling', label: 'Milling', icon: 'engineering' },
                  { id: 'turning', label: 'Turning', icon: 'rotate_right' },
                  { id: 'drilling', label: 'Drilling', icon: 'arrow_downward' },
                  { id: 'tapping', label: 'Tapping', icon: 'build' },
                  { id: 'boring', label: 'Boring', icon: 'trip_origin' },
                ]}
              />
            }
          />
        </section>

        {/* Main Split Pane Layout (5 cols left, 7 cols right) */}
        <div className="w-full grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
          {/* Left Inputs Panel */}
          <Card className="xl:col-span-5 p-space-lg flex flex-col gap-space-md">
            {/* Units Toggle & Header */}
            <div className="flex items-center justify-between pb-space-xs">
              <SectionHeader title="Tool & Cut Geometry" className="border-b-0 mb-0 pb-0" />
              {/* Segmented Unit Switcher */}
              <div className="p-1 rounded bg-surface-container-low flex items-center font-label-sm text-label-sm font-mono border border-outline-variant/30">
                <button
                  onClick={() => setIsMetric(true)}
                  className={`px-space-sm py-1 rounded cursor-pointer transition-all ${
                    isMetric ? 'bg-surface text-secondary font-bold shadow-sm' : 'text-tertiary hover:text-on-surface'
                  }`}
                  type="button"
                >
                  Metric
                </button>
                <button
                  onClick={() => setIsMetric(false)}
                  className={`px-space-sm py-1 rounded cursor-pointer transition-all ${
                    !isMetric ? 'bg-surface text-secondary font-bold shadow-sm' : 'text-tertiary hover:text-on-surface'
                  }`}
                  type="button"
                >
                  IPM
                </button>
              </div>
            </div>

            {/* Workpiece Material Selector */}
            <div className="flex flex-col gap-space-xs relative">
              <div className="flex items-center justify-between">
                <label className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-primary">layers</span>
                  Workpiece Stock Material
                </label>
                <span className="font-label-sm text-label-sm font-mono text-secondary">{material.isoGroup}</span>
              </div>
              <div
                onClick={() => setMaterialSelectorOpen(!materialSelectorOpen)}
                className="relative bg-surface-container-low rounded-lg p-space-sm flex items-center justify-between hover:bg-surface-container-high transition-colors cursor-pointer group border border-outline-variant/20"
              >
                <div className="flex flex-col min-w-0 pr-space-xs">
                  <div className="flex items-center gap-space-xs truncate">
                    <span className="font-body-md text-body-md font-semibold text-on-surface truncate">
                      {material.name}
                    </span>
                    <span className="px-space-xs py-0.5 rounded bg-surface-container-highest text-tertiary font-label-sm text-label-sm font-mono">
                      {material.hardness}
                    </span>
                  </div>
                  <span className="font-label-sm text-label-sm text-tertiary-container font-mono">
                    Yield {material.yieldMpa} MPa • Spec. Force kc1.1: {material.kc1} N/mm²
                  </span>
                </div>
                <span className="material-symbols-outlined text-tertiary group-hover:text-secondary transition-colors text-[20px]">
                  tune
                </span>
              </div>

              {/* Material Dropdown Overlay */}
              {materialSelectorOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-xl bg-surface-container-high border border-outline-variant shadow-2xl p-2 z-50 max-h-64 overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-mono uppercase text-tertiary border-b border-surface-container-highest mb-1">
                    Reference values. Confirm with your tool supplier.
                  </div>
                  {Object.values(MATERIALS).map((mat) => (
                    <button
                      key={mat.id}
                      onClick={() => {
                        setSelectedMaterialId(mat.id);
                        // set sensible Vc default in middle of range
                        const band = toolMaterial === 'carbide' ? mat.carbide.vc : mat.hss.vc;
                        setVc(Math.round((band.min + band.max) / 2));
                        setMaterialSelectorOpen(false);
                      }}
                      className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between hover:bg-surface-container transition-colors ${
                        selectedMaterialId === mat.id ? 'bg-primary-container/15 text-primary' : 'text-on-surface'
                      }`}
                      type="button"
                    >
                      <div className="flex flex-col">
                        <span className="font-headline-sm text-xs font-bold">{mat.name}</span>
                        <span className="font-mono text-[10px] text-tertiary">
                          {mat.isoGroup} • {mat.hardness} • kc1: {mat.kc1} N/mm²
                        </span>
                      </div>
                      {selectedMaterialId === mat.id && (
                        <span className="material-symbols-outlined text-primary text-[18px]">check</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tool Selection Dropdown */}
            <div className="flex flex-col gap-space-xs relative">
              <div className="flex items-center justify-between">
                <label className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-secondary">hardware</span>
                  Active Tool Assembly
                </label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setToolMaterial('carbide');
                      setVc(Math.round((material.carbide.vc.min + material.carbide.vc.max) / 2));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold cursor-pointer transition-colors ${
                      toolMaterial === 'carbide' ? 'bg-secondary text-on-secondary' : 'bg-surface-container-low text-tertiary'
                    }`}
                    type="button"
                  >
                    Solid Carbide
                  </button>
                  <button
                    onClick={() => {
                      setToolMaterial('hss');
                      setVc(Math.round((material.hss.vc.min + material.hss.vc.max) / 2));
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold cursor-pointer transition-colors ${
                      toolMaterial === 'hss' ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-low text-tertiary'
                    }`}
                    type="button"
                  >
                    HSS Grade
                  </button>
                </div>
              </div>

              <div
                onClick={() => setToolAssemblyOpen(!toolAssemblyOpen)}
                className="bg-surface-container-low rounded-lg p-space-sm flex items-center justify-between hover:bg-surface-container-high transition-colors cursor-pointer group border border-outline-variant/20"
              >
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-space-xs">
                    <span className="font-body-md text-body-md font-semibold text-on-surface truncate">
                      {toolMaterial === 'carbide' ? 'Solid Carbide End Mill' : 'High Speed Steel (HSS)'}
                    </span>
                    <span className="px-space-xs py-0.5 rounded bg-primary-container/20 text-primary-container font-label-sm text-label-sm font-mono font-bold">
                      Ø{diameter.toFixed(1)}
                    </span>
                  </div>
                  <span className="font-label-sm text-label-sm text-tertiary-container font-mono">
                    {process === 'milling' ? `${flutes}-Flute Helix • ap: ${ap}mm` : `Single Point • Nose: 0.8mm`}
                  </span>
                </div>
                <span className="material-symbols-outlined text-tertiary group-hover:text-secondary transition-colors text-[20px]">
                  expand_more
                </span>
              </div>
            </div>

            {/* Tool Geometry Stepper Grid (Dc diameter & Flutes/Pitch) */}
            <div className="grid grid-cols-2 gap-space-md">
              {/* Diameter Dc Stepper */}
              <div className="flex flex-col gap-space-xs bg-surface-container-low p-space-sm rounded-lg border border-outline-variant/20">
                <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                  Tool Diam. (Dc)
                </span>
                <div className="flex items-center justify-between mt-1">
                  <button
                    onClick={() => setDiameter((prev) => Math.max(1.0, Number((prev - 1.0).toFixed(1))))}
                    aria-label="Decrease Diameter"
                    className="touch-target w-12 h-12 rounded bg-surface-container hover:bg-surface-container-highest active:bg-surface-bright flex items-center justify-center text-on-surface transition-colors shadow-sm cursor-pointer"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[20px]">remove</span>
                  </button>
                  <div className="flex flex-col items-center">
                    <span className="font-code-lg text-code-lg font-bold text-on-surface">
                      {isMetric ? diameter.toFixed(2) : (diameter / 25.4).toFixed(3)}
                    </span>
                    <span className="font-label-sm text-label-sm text-tertiary font-mono">
                      {isMetric ? 'mm' : 'inch'}
                    </span>
                  </div>
                  <button
                    onClick={() => setDiameter((prev) => Math.min(80.0, Number((prev + 1.0).toFixed(1))))}
                    aria-label="Increase Diameter"
                    className="touch-target w-12 h-12 rounded bg-surface-container hover:bg-surface-container-highest active:bg-surface-bright flex items-center justify-center text-on-surface transition-colors shadow-sm cursor-pointer"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[20px]">add</span>
                  </button>
                </div>
              </div>

              {/* Number of Flutes (z) or Pitch (P) */}
              {process === 'tapping' ? (
                <div className="flex flex-col gap-space-xs bg-surface-container-low p-space-sm rounded-lg border border-outline-variant/20">
                  <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                    Thread Pitch (P)
                  </span>
                  <div className="flex items-center justify-between mt-1">
                    <button
                      onClick={() => setPitch((prev) => Math.max(0.25, Number((prev - 0.25).toFixed(2))))}
                      aria-label="Decrease Pitch"
                      className="touch-target w-12 h-12 rounded bg-surface-container hover:bg-surface-container-highest active:bg-surface-bright flex items-center justify-center text-on-surface transition-colors shadow-sm cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">remove</span>
                    </button>
                    <div className="flex flex-col items-center">
                      <span className="font-code-lg text-code-lg font-bold text-on-surface">{pitch.toFixed(2)}</span>
                      <span className="font-label-sm text-label-sm text-tertiary font-mono">mm/rev</span>
                    </div>
                    <button
                      onClick={() => setPitch((prev) => Math.min(6.0, Number((prev + 0.25).toFixed(2))))}
                      aria-label="Increase Pitch"
                      className="touch-target w-12 h-12 rounded bg-surface-container hover:bg-surface-container-highest active:bg-surface-bright flex items-center justify-center text-on-surface transition-colors shadow-sm cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">add</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-space-xs bg-surface-container-low p-space-sm rounded-lg border border-outline-variant/20">
                  <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                    Number of Flutes (z)
                  </span>
                  <div className="flex items-center justify-between mt-1">
                    <button
                      onClick={() => setFlutes((prev) => Math.max(1, prev - 1))}
                      aria-label="Decrease Flutes"
                      className="touch-target w-12 h-12 rounded bg-surface-container hover:bg-surface-container-highest active:bg-surface-bright flex items-center justify-center text-on-surface transition-colors shadow-sm cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">remove</span>
                    </button>
                    <div className="flex flex-col items-center">
                      <span className="font-code-lg text-code-lg font-bold text-on-surface">{flutes}</span>
                      <span className="font-label-sm text-label-sm text-tertiary font-mono">teeth</span>
                    </div>
                    <button
                      onClick={() => setFlutes((prev) => Math.min(12, prev + 1))}
                      aria-label="Increase Flutes"
                      className="touch-target w-12 h-12 rounded bg-surface-container hover:bg-surface-container-highest active:bg-surface-bright flex items-center justify-center text-on-surface transition-colors shadow-sm cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">add</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Surface Speed (Vc) Slider */}
            <div className="flex flex-col gap-space-xs bg-surface-container-low p-space-md rounded-lg border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <label className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                    SURFACE SPEED (Vc)
                  </label>
                  <span
                    className="material-symbols-outlined text-tertiary text-[16px] cursor-help"
                    title="Linear surface speed of tool periphery (m/min)"
                  >
                    info
                  </span>
                </div>
                <div className="flex items-baseline gap-1 font-mono">
                  <span className="font-code-lg text-code-lg font-bold text-secondary">{vc}</span>
                  <span className="font-label-sm text-label-sm text-tertiary">
                    {isMetric ? 'm/min' : 'SFM'}
                  </span>
                </div>
              </div>

              {/* Slider with green recommended sweet-spot range guide */}
              <div className="relative w-full py-2">
                <div className="absolute h-2 rounded bg-surface-container-highest w-full top-1/2 -translate-y-1/2 overflow-hidden">
                  <div
                    className="absolute h-full bg-secondary/35 rounded"
                    style={{
                      left: `${Math.max(0, ((recRange.min - sliderMin) / (sliderMax - sliderMin)) * 100)}%`,
                      width: `${Math.min(100, ((recRange.max - recRange.min) / (sliderMax - sliderMin)) * 100)}%`,
                    }}
                  ></div>
                </div>
                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  value={vc}
                  onChange={(e) => setVc(Number(e.target.value))}
                  className="relative z-10 w-full h-2 bg-transparent appearance-none cursor-pointer accent-primary-container"
                />
              </div>

              <div className="flex items-center justify-between font-label-sm text-label-sm font-mono text-tertiary-container px-0.5">
                <span>{sliderMin} min</span>
                <span className="text-secondary font-semibold">
                  Recommended: {recRange.min} – {recRange.max} m/min
                </span>
                <span>{sliderMax} max</span>
              </div>

              {/* Inline Physics Validation notice */}
              {results.validation.warnings.length > 0 && (
                <div className="mt-space-xs p-space-sm rounded bg-surface-container flex items-start gap-space-xs text-secondary font-mono font-code-sm text-code-sm border border-outline-variant/30">
                  <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">warning</span>
                  <span className="leading-tight">{results.validation.warnings[0]}</span>
                </div>
              )}
            </div>

            {/* Feed Slider & Input */}
            <div className="flex flex-col gap-space-xs bg-surface-container-low p-space-md rounded-lg border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <label className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                  {process === 'milling' ? 'Feed per Tooth (fz)' : 'Feed per Revolution (fn)'}
                </label>
                <div className="flex items-baseline gap-1 font-mono">
                  <span className="font-code-lg text-code-lg font-bold text-on-surface">{feed.toFixed(3)}</span>
                  <span className="font-label-sm text-label-sm text-tertiary">
                    {process === 'milling' ? 'mm/tooth' : 'mm/rev'}
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0.01}
                max={0.35}
                step={0.005}
                value={feed}
                onChange={(e) => setFeed(Number(e.target.value))}
                className="w-full h-2 bg-surface-container-highest rounded appearance-none cursor-pointer accent-primary-container"
              />
              <div className="flex justify-between font-label-sm text-label-sm font-mono text-tertiary-container">
                <span>0.020 (Finishing)</span>
                <span className="text-on-surface">Slot / Profile Band: 0.050 – 0.150</span>
                <span>0.300 (Roughing)</span>
              </div>
            </div>

            {/* Axial Depth (ap) & Radial Width (ae) */}
            <div className="grid grid-cols-2 gap-space-md">
              <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col gap-1 border border-outline-variant/20">
                <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                  Axial Depth (ap)
                </span>
                <div className="flex items-center justify-between">
                  <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    value={ap}
                    onChange={(e) => setAp(Number(e.target.value))}
                    className="bg-surface-container text-on-surface font-code-md text-code-md font-bold px-2 py-1.5 rounded w-24 focus:outline-none focus:text-secondary border border-outline-variant/40"
                  />
                  <span className="font-label-sm text-label-sm text-tertiary font-mono">mm</span>
                </div>
                <span className="font-label-sm text-label-sm text-tertiary-container font-mono">Stepdown Depth</span>
              </div>

              <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col gap-1 border border-outline-variant/20">
                <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary-container">
                  Radial Width (ae)
                </span>
                <div className="flex items-center justify-between">
                  <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    value={ae}
                    onChange={(e) => setAe(Number(e.target.value))}
                    className="bg-surface-container text-on-surface font-code-md text-code-md font-bold px-2 py-1.5 rounded w-24 focus:outline-none focus:text-secondary border border-outline-variant/40"
                  />
                  <span className="font-label-sm text-label-sm text-tertiary font-mono">mm</span>
                </div>
                <span className="font-label-sm text-label-sm text-secondary font-mono">
                  {Math.round((ae / diameter) * 100)}% Engagement
                </span>
              </div>
            </div>

            {/* Machine Physical Limits Summary */}
            <div className="p-space-sm rounded bg-surface-container-lowest flex items-center justify-between font-label-sm text-label-sm font-mono text-tertiary border border-outline-variant/20">
              <div className="flex items-center gap-space-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                <span>
                  Max Spindle:{' '}
                  <input
                    type="number"
                    value={maxSpindleRpm}
                    onChange={(e) => setMaxSpindleRpm(Number(e.target.value))}
                    className="w-16 bg-transparent text-on-surface font-bold underline decoration-dotted text-right focus:outline-none"
                  />{' '}
                  RPM
                </span>
              </div>
              <div className="flex items-center gap-space-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
                <span>
                  Motor:{' '}
                  <input
                    type="number"
                    step="0.5"
                    value={machineMaxKw}
                    onChange={(e) => setMachineMaxKw(Number(e.target.value))}
                    className="w-12 bg-transparent text-on-surface font-bold underline decoration-dotted text-right focus:outline-none"
                  />{' '}
                  kW
                </span>
              </div>
            </div>

            {/* Recalculate Physics CTA Button */}
            <ButtonPrimary
              onClick={logCalculation}
              loading={justCalculated}
              icon={justCalculated ? 'check_circle' : 'precision_manufacturing'}
              className="w-full h-12"
            >
              {justCalculated ? 'Physics Engine Computed & Logged' : 'Calculate Physics Engine'}
            </ButtonPrimary>
          </Card>

          {/* Right Results Panel (7 cols of 12) */}
          <div className="xl:col-span-7 flex flex-col gap-space-lg">
            {/* 3D Tool Contact & Chip Geometry Viewport */}
            <Calculator3DView
              rpm={results.rpm}
              feedRate={results.feedRate}
              diameter={diameter}
              process={process}
              powerZone={results.powerZone}
              tangentialForce={results.tangentialForce}
            />

            {/* Core Physics Metrics Grid (2x2) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
              {/* Metric Card 1: Spindle Speed (n) */}
              <Card className="p-space-md flex flex-col justify-between">
                <SectionHeader 
                  title="Spindle Speed (n)" 
                  actions={<Badge variant="secondary">{Math.round((results.rpm / maxSpindleRpm) * 100)}% Cap</Badge>}
                  className="border-b-0 mb-0 pb-0"
                />
                <div className="flex items-baseline gap-space-xs my-space-xs">
                  <span className="font-code-lg text-[32px] leading-none font-bold text-on-surface tracking-tight">
                    {results.rpm.toLocaleString()}
                  </span>
                  <span className="font-label-md text-label-md font-mono text-tertiary">RPM</span>
                </div>
                <div className="flex items-center justify-between pt-space-xs text-tertiary-container font-label-sm text-label-sm font-mono">
                  <span>Vc = {vc} m/min • Dc = {diameter}mm</span>
                  <span className="text-secondary font-semibold">
                    {results.rpm > maxSpindleRpm ? 'EXCEEDS CAPACITY' : 'Axis Safe'}
                  </span>
                </div>
              </Card>

              {/* Metric Card 2: Feed Rate (Vf) */}
              <Card className="p-space-md flex flex-col justify-between">
                <SectionHeader 
                  title="Feed Rate (Vf)" 
                  actions={<Badge variant="tertiary">h: {results.chipThickness}mm</Badge>}
                  className="border-b-0 mb-0 pb-0"
                />
                <div className="flex items-baseline gap-space-xs my-space-xs">
                  <span className="font-code-lg text-[32px] leading-none font-bold text-on-surface tracking-tight">
                    {isMetric ? results.feedRate.toLocaleString() : (results.feedRate / 25.4).toFixed(1)}
                  </span>
                  <span className="font-label-md text-label-md font-mono text-tertiary">
                    {isMetric ? 'mm/min' : 'IPM'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-space-xs text-tertiary-container font-label-sm text-label-sm font-mono">
                  <span>{process === 'milling' ? `z = ${flutes} teeth` : `Single edge`} • {(results.feedRate / 60).toFixed(1)} mm/s</span>
                  <span className="text-on-surface">Axis Limit Safe</span>
                </div>
              </Card>

              {/* Metric Card 3: Material Removal Rate (MRR) */}
              <Card className="p-space-md flex flex-col justify-between">
                <SectionHeader 
                  title="Material Removal Rate" 
                  actions={<Badge variant="primary">High Efficiency</Badge>}
                  className="border-b-0 mb-0 pb-0"
                />
                <div className="flex items-baseline gap-space-xs my-space-xs">
                  <span className="font-code-lg text-[32px] leading-none font-bold text-primary-container tracking-tight">
                    {formatMrr(results.mrr).split(' ')[0]}
                  </span>
                  <span className="font-label-md text-label-md font-mono text-tertiary">
                    {isMetric ? 'cm³/min' : 'in³/min'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-space-xs text-tertiary-container font-label-sm text-label-sm font-mono">
                  <span>{process === 'milling' ? `ap: ${ap}mm × ae: ${ae}mm` : `ap: ${ap || 2}mm`}</span>
                  <span className="text-primary-container font-semibold">
                    {Math.round((results.mrr * 60) / 1000)} dm³/hr
                  </span>
                </div>
              </Card>

              {/* Metric Card 4: Spindle Torque (Mc) */}
              <Card className="p-space-md flex flex-col justify-between">
                <SectionHeader 
                  title={process === 'turning' || process === 'boring' ? 'Surface Finish (Ra)' : process === 'drilling' ? 'Drill Thrust (Ff)' : 'Spindle Torque'}
                  actions={<Badge variant="tertiary">{process === 'turning' || process === 'boring' ? 'Nose r: 0.8mm' : `Rated: ${Math.round((machineMaxKw * 9550) / 3000)} N·m`}</Badge>}
                  className="border-b-0 mb-0 pb-0"
                />
                <div className="flex items-baseline gap-space-xs my-space-xs">
                  <span className="font-code-lg text-[32px] leading-none font-bold text-on-surface tracking-tight">
                    {process === 'turning' || process === 'boring' ? results.raUm : process === 'drilling' ? results.thrustForceN : results.torqueNm}
                  </span>
                  <span className="font-label-md text-label-md font-mono text-tertiary">
                    {process === 'turning' || process === 'boring' ? 'µm Ra' : process === 'drilling' ? 'N' : isMetric ? 'N·m' : 'ft·lb'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-space-xs text-tertiary-container font-label-sm text-label-sm font-mono">
                  <span>{process === 'turning' || process === 'boring' ? `Cycle: ${results.cycleTimeMin} min` : 'Low Thermal Strain'}</span>
                  <span className="text-secondary font-semibold">
                    {process === 'turning' || process === 'boring' ? 'Iso Finish N7' : 'Nominal'}
                  </span>
                </div>
              </Card>
            </div>

            {/* Tapping Rigid G-code Block Display (if tapping) */}
            {process === 'tapping' && results.gcodeBlock && (
              <div className="bg-surface-container rounded-xl p-space-md border border-secondary/30 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-xs font-mono text-secondary uppercase font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">terminal</span>
                    Fanuc Rigid Tapping Block (G84)
                  </span>
                  <span className="font-mono text-xs text-tertiary">
                    Tap Drill: <strong className="text-on-surface">Ø{results.tapDrillMm} mm</strong>
                  </span>
                </div>
                <div className="bg-surface-container-lowest p-space-sm rounded font-mono text-xs text-on-surface space-y-1">
                  {results.gcodeBlock.map((line, idx) => (
                    <div key={idx} className="text-secondary font-semibold">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cutting Power Consumption Gauge Card */}
            <div className="bg-surface-container rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm border border-outline-variant/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-secondary text-[20px]">bolt</span>
                  <span className="font-headline-sm text-headline-sm text-on-surface">
                    Cutting Power Consumption
                  </span>
                </div>
                <div className="font-mono font-label-md text-label-md">
                  <span className="text-on-surface font-bold">{results.powerKw} kW</span>
                  <span className="text-tertiary"> / {machineMaxKw} kW Max</span>
                  <span
                    className={`px-space-xs py-0.5 rounded ml-1 font-bold ${
                      results.powerZone === 'red'
                        ? 'bg-error-container/30 text-error'
                        : results.powerZone === 'amber'
                        ? 'bg-primary-container/20 text-primary-container'
                        : 'bg-secondary/20 text-secondary'
                    }`}
                  >
                    {results.powerPercent}% Spindle Load
                  </span>
                </div>
              </div>

              {/* Horizontal Multi-Zone Progress Meter */}
              <div className="relative w-full h-4 rounded-full bg-surface-container-lowest overflow-hidden shadow-inner mt-2">
                {/* Load Fill Bar */}
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    results.powerZone === 'red'
                      ? 'bg-error'
                      : results.powerZone === 'amber'
                      ? 'bg-primary-container'
                      : 'bg-secondary'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(4, results.powerPercent))}%` }}
                ></div>
                {/* Amber Safety Limit Tick (70%) */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-primary-container z-20" style={{ left: '70%' }}></div>
                {/* Red Spindle Overload Threshold (90%) */}
                <div className="absolute top-0 bottom-0 w-0.5 bg-error z-20" style={{ left: '90%' }}></div>
              </div>

              <div className="flex items-center justify-between font-label-sm text-label-sm font-mono text-tertiary-container mt-1">
                <span>0.0 kW (Idle)</span>
                <span className="text-primary-container">70% Continuous Duty ({(machineMaxKw * 0.7).toFixed(1)} kW)</span>
                <span className="text-error">90% Peak Ceiling ({(machineMaxKw * 0.9).toFixed(1)} kW)</span>
              </div>

              <div className="mt-space-xs pt-space-xs bg-surface-container-low p-space-sm rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs font-label-sm text-label-sm font-mono text-tertiary border border-outline-variant/20">
                <span>
                  Kienzle Specific Force: <strong className="text-on-surface">kc1.1 = {material.kc1} N/mm²</strong>
                </span>
                <span>
                  Tangential Cutting Force: <strong className="text-secondary">{results.tangentialForce} N</strong>
                </span>
                <span>
                  Tool Deflection:{' '}
                  <strong className="text-on-surface">
                    {results.tangentialForce > 800 ? '> 0.012 mm' : '< 0.004 mm'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Bottom Copilot Action Trigger */}
            <Card accent={results.powerZone === 'red' ? 'red' : results.powerZone === 'amber' ? 'amber' : 'cyan'} className="p-space-md">
              <ButtonSecondary
                onClick={handleAskCopilot}
                icon="psychology"
                className="w-full h-12"
              >
                Ask CNC Copilot to verify this setup
              </ButtonSecondary>
            </Card>
          </div>
        </div>
      </div>

      {/* Slide-out Side Drawer for "Ask Copilot Why" AI Explanation */}
      <Drawer
        isOpen={explainDrawerOpen}
        onClose={() => setExplainDrawerOpen(false)}
        title="Copilot Process Analysis"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="font-label-sm text-[10px] text-tertiary font-mono uppercase">AI explains. Physics decides.</span>
            <ButtonSecondary onClick={() => setExplainDrawerOpen(false)}>Close</ButtonSecondary>
          </div>
        }
      >
        <div className="flex flex-col gap-space-md">
          {/* Engine Summary Banner */}
          <div className="p-3 rounded-lg bg-surface-container border border-outline-variant/30 text-xs font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-tertiary">Material:</span>
              <span className="text-on-surface font-semibold">{material.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Spindle Load:</span>
              <span className={results.powerZone === 'red' ? 'text-error font-bold' : results.powerZone === 'amber' ? 'text-primary-container font-bold' : 'text-secondary font-bold'}>
                {results.powerPercent}% ({results.powerKw} kW)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-tertiary">Speed Band:</span>
              <span className="text-tertiary-fixed">{vc} m/min (Recommended: {recRange.min}-{recRange.max})</span>
            </div>
          </div>

          {/* AI Explanation Area */}
          {explaining && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-secondary font-mono text-xs text-center">
              <div className="w-12 h-12 border-2 border-secondary border-t-transparent rounded-full animate-spin mb-2" />
              <span>Synthesizing Kienzle force and chip dynamics...</span>
            </div>
          )}

          {explainError && (
            <div className="p-4 rounded-lg bg-error-container/20 border border-error/30 text-error text-xs font-mono flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <div>
                <span className="font-bold block">Analysis Failed</span>
                <span>{explainError}</span>
              </div>
            </div>
          )}

            {explanation && (
            <div className="p-4 rounded-xl bg-surface-container border border-outline-variant/40 text-on-surface text-sm leading-relaxed whitespace-pre-wrap font-body-md shadow-sm">
              {explanation}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
