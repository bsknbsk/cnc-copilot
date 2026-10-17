import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ProcessType } from '../../engine/cutting.js';

interface Calculator3DViewProps {
  rpm: number;
  feedRate: number;
  diameter: number;
  process: ProcessType;
  powerZone: 'green' | 'amber' | 'red';
  tangentialForce: number;
}

function CutterAndStock({
  rpm,
  feedRate,
  diameter,
  process,
  isPlaying,
  animSpeed,
  onProgress,
  resetSignal,
}: {
  rpm: number;
  feedRate: number;
  diameter: number;
  process: ProcessType;
  isPlaying: boolean;
  animSpeed: number;
  onProgress?: (progress: number) => void;
  resetSignal: number;
}) {
  const cutterRef = useRef<THREE.Group>(null);
  const stockRef = useRef<THREE.Mesh>(null);
  const chipsRef = useRef<THREE.Group>(null);
  const progressRef = useRef(0);
  const lastResetRef = useRef(resetSignal);

  if (lastResetRef.current !== resetSignal) {
    lastResetRef.current = resetSignal;
    progressRef.current = 0;
  }

  const scaledRadius = Math.max(0.18, Math.min(0.8, diameter / 30));

  // Initialize random particle offsets for chip ejection sparks
  const chipParticles = useRef(
    Array.from({ length: 10 }, () => ({
      vx: (Math.random() - 0.3) * 2.5,
      vy: Math.random() * 2.2 + 0.8,
      vz: (Math.random() - 0.5) * 2.5,
      size: Math.random() * 0.035 + 0.02,
    }))
  );

  useFrame((_, delta) => {
    if (!isPlaying) return;

    // 1. Spindle rotation: clearly spinning at RPM
    if (cutterRef.current) {
      const rotSpeed = Math.min(32, Math.max(2, (rpm / 500) * 2 * Math.PI));
      cutterRef.current.rotation.y += delta * rotSpeed * animSpeed;
    }

    // 2. Feed cycle progression (normalized cutting cycle scaled by feed rate)
    const baseDuration = 4.0;
    const feedScale = Math.min(2.5, Math.max(0.6, feedRate / 600));
    progressRef.current = (progressRef.current + (delta / baseDuration) * feedScale * animSpeed) % 1.0;
    onProgress?.(progressRef.current);

    // 3. Dynamic Tool Motion by Machining Process
    const p = progressRef.current;
    let toolX = 0;
    let toolY = 0.9;
    let toolZ = 0;
    let isCutting = true;

    if (process === 'milling') {
      // Translates across the workpiece block from X = -1.6 to +1.6 at cutting depth
      toolX = -1.6 + p * 3.2;
      toolY = 0.45;
      toolZ = 0.35;
      isCutting = true;
    } else {
      // Drilling, Tapping, Boring: plunges into workpiece block along Y and retracts
      const plunge = Math.sin(p * Math.PI);
      toolX = 0;
      toolY = 0.9 - plunge * 0.75;
      toolZ = 0;
      isCutting = plunge > 0.2;
    }

    if (cutterRef.current) {
      cutterRef.current.position.set(toolX, toolY, toolZ);
    }

    // 4. Animate chip ejection sparks
    if (chipsRef.current) {
      chipsRef.current.visible = isCutting;
      if (isCutting) {
        chipsRef.current.position.set(toolX, toolY - 0.4, toolZ);
        chipsRef.current.children.forEach((child, i) => {
          const cp = chipParticles.current[i];
          child.position.x += cp.vx * delta;
          child.position.y += cp.vy * delta;
          child.position.z += cp.vz * delta;
          cp.vy -= 9.8 * delta;
          if (child.position.y < -0.3) {
            child.position.set(0, 0, 0);
            cp.vx = (Math.random() - 0.3) * 2.5;
            cp.vy = Math.random() * 2.2 + 0.8;
            cp.vz = (Math.random() - 0.5) * 2.5;
          }
        });
      }
    }
  });

  return (
    <group position={[0, -0.4, 0]}>
      {/* Workpiece Stock Block */}
      <mesh ref={stockRef} position={[0, -0.6, 0]}>
        <boxGeometry args={[4.2, 1.2, 3.0]} />
        <meshStandardMaterial color="#1c2025" roughness={0.5} metalness={0.7} />
      </mesh>

      {/* Fixture Clamping Jaw */}
      <mesh position={[0, -1.3, 0]}>
        <boxGeometry args={[5.0, 0.4, 3.6]} />
        <meshStandardMaterial color="#101419" roughness={0.8} />
      </mesh>

      {/* Tool Assembly Group */}
      <group ref={cutterRef} position={[0, 0.9, 0]}>
        {/* Toolholder Body */}
        <mesh position={[0, 1.4, 0]}>
          <cylinderGeometry args={[0.55, 0.75, 1.4, 20]} />
          <meshStandardMaterial color="#262a30" roughness={0.4} metalness={0.8} />
        </mesh>

        {/* Toolholder Drive Keys (High-contrast spinning drive notches) */}
        <mesh position={[0.62, 0.72, 0]}>
          <boxGeometry args={[0.12, 0.18, 0.24]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[-0.62, 0.72, 0]}>
          <boxGeometry args={[0.12, 0.18, 0.24]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
        </mesh>

        {/* Safety Orange Accent Ring */}
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.45, 0.5, 0.25, 20]} />
          <meshStandardMaterial color="#ff7a1a" roughness={0.3} metalness={0.5} />
        </mesh>

        {/* Flute Cutter Body */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[scaledRadius, scaledRadius, 0.9, 20]} />
          <meshStandardMaterial
            color={process === 'tapping' ? '#ffb68e' : process === 'drilling' ? '#22c55e' : '#5de6ff'}
            roughness={0.2}
            metalness={0.9}
          />
        </mesh>

        {/* 4 High-Contrast Flutes & Carbide Inserts */}
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, idx) => (
          <group key={idx} rotation={[0, angle, 0]}>
            {/* Flute blade fin with alternating dark tungsten and orange coating */}
            <mesh position={[scaledRadius * 0.94, 0.05, 0]} rotation={[0, 0, -0.06]}>
              <boxGeometry args={[scaledRadius * 0.28, 0.88, 0.05]} />
              <meshStandardMaterial
                color={idx % 2 === 0 ? '#0f172a' : '#ea580c'}
                roughness={0.25}
                metalness={0.85}
              />
            </mesh>
            {/* Gold TiN Carbide Insert at Cutting Edge */}
            <mesh position={[scaledRadius * 1.02, -0.36, 0]}>
              <boxGeometry args={[scaledRadius * 0.22, 0.14, 0.07]} />
              <meshStandardMaterial color="#fbbf24" roughness={0.15} metalness={0.95} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Dynamic Flying Cutting Chips */}
      <group ref={chipsRef} position={[0, 0, 0]}>
        {chipParticles.current.map((p, i) => (
          <mesh key={i} position={[0, 0, 0]}>
            <boxGeometry args={[p.size, p.size, p.size]} />
            <meshStandardMaterial color="#fbbf24" emissive="#ff7a1a" emissiveIntensity={0.8} />
          </mesh>
        ))}
      </group>

      {/* Grid Floor */}
      <gridHelper args={[8, 16, '#ff7a1a', '#1f2a37']} position={[0, -1.5, 0]} />
    </group>
  );
}

export function Calculator3DView({
  rpm,
  feedRate,
  diameter,
  process,
  powerZone,
  tangentialForce,
}: Calculator3DViewProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1.0);
  const [resetCounter, setResetCounter] = useState(0);
  const scrubberBarRef = useRef<HTMLDivElement>(null);

  const handleProgress = (p: number) => {
    if (scrubberBarRef.current) {
      scrubberBarRef.current.style.width = `${Math.min(100, Math.max(2, Math.round(p * 100)))}%`;
    }
  };

  const handleReset = () => {
    setIsPlaying(true);
    setSpeedMultiplier(1.0);
    setResetCounter((c) => c + 1);
    if (scrubberBarRef.current) {
      scrubberBarRef.current.style.width = '2%';
    }
  };

  return (
    <div className="w-full h-full min-h-[480px] lg:min-h-[520px] bg-surface-container-lowest rounded-xl relative p-space-md flex flex-col justify-between overflow-hidden shadow-xl border border-outline-variant/40">
      {/* Living Background Grid */}
      <div className="absolute inset-0 opacity-15 pointer-events-none">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern height="32" id="calcGrid" patternUnits="userSpaceOnUse" width="32">
              <path className="text-secondary" d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.7"></path>
            </pattern>
          </defs>
          <rect fill="url(#calcGrid)" height="100%" width="100%"></rect>
        </svg>
      </div>

      {/* Viewport Top Bar */}
      <div className="relative z-10 flex items-center justify-between bg-surface-container/85 backdrop-blur-md px-space-sm py-1.5 rounded-lg shadow-sm border border-outline-variant/30">
        <div className="flex items-center gap-space-sm min-w-0">
          <span className="w-2 h-2 rounded-full bg-secondary animate-ping flex-shrink-0"></span>
          <span className="font-headline-sm text-sm font-bold text-on-surface truncate">
            Simulation: Tool Contact & Chip Geometry
          </span>
        </div>
        <div className="flex items-center gap-space-md">
          {/* XYZ Axis Triad Readout */}
          <div className="flex items-center gap-space-xs font-mono font-label-sm text-xs">
            <span className="px-1.5 py-0.5 rounded bg-error/20 text-error font-bold">X</span>
            <span className="px-1.5 py-0.5 rounded bg-secondary/20 text-secondary font-bold">Y</span>
            <span className="px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container font-bold">Z</span>
          </div>
          {/* Status Badge */}
          <div className="hidden sm:flex items-center gap-1 px-space-xs py-0.5 rounded bg-secondary/15 text-secondary font-label-sm text-[11px] font-mono font-semibold">
            <span className="material-symbols-outlined text-[14px]">verified</span>
            <span>
              {powerZone === 'red'
                ? 'OVERLOAD DEFLECTION'
                : powerZone === 'amber'
                ? 'CAUTION: HEAVY LOAD'
                : 'STABLE CUT • NO CHATTER'}
            </span>
          </div>
        </div>
      </div>

      {/* 3D Canvas Canvas */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Canvas camera={{ position: [3.8, 3.2, 4.4], fov: 42 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[8, 12, 6]} intensity={1.2} />
          <pointLight position={[-4, 6, 4]} intensity={0.8} color="#ff7a1a" />
          <pointLight position={[0, 3, 0]} intensity={1.0} color="#5de6ff" />
          <CutterAndStock
            rpm={rpm}
            feedRate={feedRate}
            diameter={diameter}
            process={process}
            isPlaying={isPlaying}
            animSpeed={speedMultiplier}
            onProgress={handleProgress}
            resetSignal={resetCounter}
          />
          <OrbitControls enableZoom={false} maxPolarAngle={Math.PI / 2.1} minPolarAngle={Math.PI / 6} />
        </Canvas>
      </div>

      {/* Overlay Force Label */}
      <div className="absolute left-4 top-14 z-10 pointer-events-none font-mono text-[11px] text-secondary bg-surface-container-lowest/80 px-2 py-0.5 rounded border border-outline-variant/30">
        <span>Ft: {tangentialForce}N</span>
        <span className="text-tertiary-container ml-2">RPM: {rpm}</span>
      </div>

      {/* Viewport Bottom Overlay Bar: Controls & Scrubber */}
      <div className="relative z-10 flex items-center justify-between bg-surface-container/85 backdrop-blur-md px-space-md py-space-xs rounded-lg shadow-sm border border-outline-variant/30">
        <div className="flex items-center gap-space-sm">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause Simulation' : 'Play Simulation'}
            className="w-8 h-8 rounded bg-surface-container-high hover:bg-surface-bright flex items-center justify-center text-on-surface cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <button
            onClick={handleReset}
            aria-label="Reset View"
            className="w-8 h-8 rounded bg-surface-container-high hover:bg-surface-bright flex items-center justify-center text-tertiary hover:text-on-surface cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">replay</span>
          </button>
          <span className="font-label-sm text-xs font-mono text-tertiary ml-space-xs hidden sm:inline">
            Vf: {feedRate} mm/min
          </span>
        </div>

        {/* Timeline Scrubber Mock track */}
        <div className="flex-1 max-w-xs mx-space-md h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
          <div
            ref={scrubberBarRef}
            className="h-full bg-secondary rounded-full animate-pulse"
            style={{ width: '0%' }}
          ></div>
        </div>

        <div className="flex items-center gap-space-xs">
          <span className="font-label-sm text-[10px] font-mono text-tertiary">SPEED</span>
          <button
            onClick={() => setSpeedMultiplier((prev) => (prev === 1.0 ? 1.5 : prev === 1.5 ? 0.5 : 1.0))}
            className="px-1.5 py-0.5 rounded bg-surface-container text-secondary font-label-sm text-xs font-mono font-bold cursor-pointer"
            type="button"
          >
            {speedMultiplier}x
          </button>
        </div>
      </div>
    </div>
  );
}
