import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder, PerspectiveCamera, OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { ACADEMY_GEOMETRY } from '../../engine/crash.js';

interface MachineSceneProps {
  toolPosition: { x: number; y: number; z: number };
  spindleOn: boolean;
  isCrashing: boolean;
  crashObject?: 'STOCK' | 'VISE' | 'TABLE' | null;
}

export function MachineScene({ toolPosition, spindleOn, isCrashing, crashObject }: MachineSceneProps) {
  const toolRef = useRef<THREE.Group>(null);
  const spindleRef = useRef<THREE.Mesh>(null);
  
  // Animation for tool rotation
  useFrame((state, delta) => {
    if (spindleOn && spindleRef.current) {
      spindleRef.current.rotation.y += 15 * delta;
    }
    
    if (toolRef.current) {
      // Smoothly follow toolPosition
      // We need to map engine coordinates to 3D scene.
      // Engine: Z is up. 
      // Three.js default: Y is up.
      // Let's use Engine Z -> Three Y, Engine X -> Three X, Engine Y -> Three -Z
      toolRef.current.position.set(toolPosition.x, toolPosition.z, -toolPosition.y);
    }
  });

  const visePos = [
    (ACADEMY_GEOMETRY.vise.x[0] + ACADEMY_GEOMETRY.vise.x[1]) / 2,
    (ACADEMY_GEOMETRY.vise.z[0] + ACADEMY_GEOMETRY.vise.z[1]) / 2,
    -(ACADEMY_GEOMETRY.vise.y[0] + ACADEMY_GEOMETRY.vise.y[1]) / 2,
  ] as [number, number, number];

  const viseSize = [
    ACADEMY_GEOMETRY.vise.x[1] - ACADEMY_GEOMETRY.vise.x[0],
    ACADEMY_GEOMETRY.vise.z[1] - ACADEMY_GEOMETRY.vise.z[0],
    ACADEMY_GEOMETRY.vise.y[1] - ACADEMY_GEOMETRY.vise.y[0],
  ] as [number, number, number];

  const stockPos = [
    (ACADEMY_GEOMETRY.stock.x[0] + ACADEMY_GEOMETRY.stock.x[1]) / 2,
    (ACADEMY_GEOMETRY.stock.z[0] + ACADEMY_GEOMETRY.stock.z[1]) / 2,
    -(ACADEMY_GEOMETRY.stock.y[0] + ACADEMY_GEOMETRY.stock.y[1]) / 2,
  ] as [number, number, number];

  const stockSize = [
    ACADEMY_GEOMETRY.stock.x[1] - ACADEMY_GEOMETRY.stock.x[0],
    ACADEMY_GEOMETRY.stock.z[1] - ACADEMY_GEOMETRY.stock.z[0],
    ACADEMY_GEOMETRY.stock.y[1] - ACADEMY_GEOMETRY.stock.y[0],
  ] as [number, number, number];

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[100, 100, 100]} intensity={1} castShadow />
      <pointLight position={[-100, 50, -100]} intensity={0.5} />

      {/* Machine Table (Cast Iron) */}
      <Box 
        args={[200, 5, 200]} 
        position={[40, ACADEMY_GEOMETRY.table.z - 2.5, -25]}
      >
        <meshStandardMaterial 
          color={crashObject === 'TABLE' && isCrashing ? '#ef4444' : '#475569'} 
          metalness={0.6} 
          roughness={0.4} 
        />
      </Box>

      {/* Vise (Industrial Blue) */}
      <Box 
        args={viseSize} 
        position={visePos}
      >
        <meshStandardMaterial 
          color={crashObject === 'VISE' && isCrashing ? '#ef4444' : '#1e3a8a'} 
          metalness={0.7} 
          roughness={0.3} 
        />
      </Box>

      {/* Stock (Aluminum 6061) */}
      <Box 
        args={stockSize} 
        position={stockPos}
      >
        <meshStandardMaterial 
          color={crashObject === 'STOCK' && isCrashing ? '#ef4444' : '#cbd5e1'} 
          metalness={0.8} 
          roughness={0.2} 
        />
      </Box>

      {/* Spindle & Tool Group */}
      <group ref={toolRef}>
        {/* Tool (Dark Carbide End Mill) */}
        <Cylinder args={[3, 3, 30, 16]} position={[0, -15, 0]}>
          <meshStandardMaterial 
            color="#1e293b" 
            metalness={0.9} 
            roughness={0.1} 
          />
        </Cylinder>
        
        {/* Tool Holder (Polished Stainless Steel) */}
        <Cylinder ref={spindleRef} args={[8, 10, 20, 24]} position={[0, 10, 0]}>
          <meshStandardMaterial 
            color="#94a3b8" 
            metalness={1.0} 
            roughness={0.05} 
          />
        </Cylinder>

        {/* Local Spindle Glow */}
        {spindleOn && (
          <pointLight color="#22d3ee" intensity={0.8} distance={40} />
        )}
      </group>

      <Grid
        infiniteGrid
        fadeDistance={400}
        fadeStrength={3}
        sectionSize={20}
        sectionColor="#94a3b8"
        cellColor="#e2e8f0"
      />
    </>
  );
}
