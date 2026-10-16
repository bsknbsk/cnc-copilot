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
  diameter,
  process,
  isPlaying,
  animSpeed,
}: {
  rpm: number;
  diameter: number;
  process: ProcessType;
  isPlaying: boolean;
  animSpeed: number;
}) {
  const cutterRef = useRef<THREE.Group>(null);
  const stockRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!isPlaying) return;
    if (cutterRef.current) {
      // Rotation proportional to RPM (scaled safely for rendering)
      const rotSpeed = Math.min(25, Math.max(1, (rpm / 600) * 2 * Math.PI));
      cutterRef.current.rotation.y += delta * rotSpeed * animSpeed;
    }
  });

  const scaledRadius = Math.max(0.15, Math.min(0.8, diameter / 30));

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

        {/* Safety Orange Accent Ring */}
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.45, 0.5, 0.25, 20]} />
          <meshStandardMaterial color="#ff7a1a" roughness={0.3} metalness={0.5} />
        </mesh>

        {/* Flute Cutter Body */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[scaledRadius, scaledRadius, 0.9, 16]} />
          <meshStandardMaterial
            color={process === 'tapping' ? '#ffb68e' : process === 'drilling' ? '#22c55e' : '#5de6ff'}
            roughness={0.2}
            metalness={0.9}
          />
        </mesh>
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

  return (
    <div className="w-full h-[280px] bg-surface-container-lowest rounded-xl relative p-space-md flex flex-col justify-between overflow-hidden shadow-xl border border-outline-variant/40">
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
        <div className="flex items-center gap-space-sm">
          <span className="w-2 h-2 rounded-full bg-secondary animate-ping"></span>
          <span className="font-headline-sm text-sm font-bold text-on-surface">
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
            diameter={diameter}
            process={process}
            isPlaying={isPlaying}
            animSpeed={speedMultiplier}
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
            onClick={() => {
              setIsPlaying(true);
              setSpeedMultiplier(1.0);
            }}
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
          <div className="h-full bg-secondary rounded-full animate-pulse" style={{ width: '65%' }}></div>
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
