import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Grid } from '@react-three/drei';
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
  const chipsRef = useRef<THREE.Group>(null);

  const chipParticles = useRef(
    Array.from({ length: 12 }, () => ({
      vx: (Math.random() - 0.4) * 2.2,
      vy: Math.random() * 2.0 + 0.8,
      vz: (Math.random() - 0.5) * 2.2,
      size: Math.random() * 0.4 + 0.3,
    }))
  );

  // Animation for tool rotation, position tracking, and chip sparks
  useFrame((state, delta) => {
    if (toolRef.current) {
      // Map engine coordinates (Z up) to Three.js (Y up):
      // Engine X -> Three X, Engine Z -> Three Y, Engine Y -> Three -Z
      toolRef.current.position.set(toolPosition.x, toolPosition.z, -toolPosition.y);
      if (spindleOn) {
        toolRef.current.rotation.y += 18 * delta;
      }
    }

    // Dynamic chip ejection sparks when cutter contacts stock
    if (chipsRef.current) {
      const isCutting = spindleOn && toolPosition.z <= 0.5 && toolPosition.z >= -20 && toolPosition.x >= -5 && toolPosition.x <= 85;
      chipsRef.current.children.forEach((child, i) => {
        if (!isCutting) {
          child.position.set(0, -1000, 0);
          return;
        }
        const p = chipParticles.current[i];
        const t = (state.clock.elapsedTime * 4.0 + i * 0.2) % 1.0;
        child.position.x = p.vx * t * 14;
        child.position.y = -10 + p.vy * t * 10 - 9.8 * t * t * 3;
        child.position.z = p.vz * t * 14;
        child.scale.setScalar((1.0 - t) * p.size);
      });
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
      <ambientLight intensity={0.7} />
      <directionalLight position={[80, 120, 60]} intensity={1.2} />
      <pointLight position={[-40, 60, 40]} intensity={0.8} color="#ff7a1a" />
      <pointLight position={[0, 40, 0]} intensity={1.0} color="#5de6ff" />

      {/* Machine Table / Base Bed */}
      <Box 
        args={[240, 6, 240]} 
        position={[40, ACADEMY_GEOMETRY.table.z - 3, -25]}
      >
        <meshStandardMaterial 
          color={crashObject === 'TABLE' && isCrashing ? '#ef4444' : '#121416'} 
          metalness={0.85} 
          roughness={0.4} 
        />
      </Box>

      {/* Vise (Industrial Dark Fixture) */}
      <Box 
        args={viseSize} 
        position={visePos}
      >
        <meshStandardMaterial 
          color={crashObject === 'VISE' && isCrashing ? '#ef4444' : '#1a1d20'} 
          metalness={0.75} 
          roughness={0.35} 
        />
      </Box>

      {/* Stock (Dark Industrial Workpiece Block matching Tool Contact simulation) */}
      <Box 
        args={stockSize} 
        position={stockPos}
      >
        <meshStandardMaterial 
          color={crashObject === 'STOCK' && isCrashing ? '#ef4444' : '#1f2225'} 
          metalness={0.7} 
          roughness={0.45} 
        />
      </Box>

      {/* Spindle & Tool Group */}
      <group ref={toolRef}>
        {/* Tool Holder (conical CAT40 style with orange grip collar) */}
        <mesh position={[0, 20, 0]}>
          <cylinderGeometry args={[6, 14, 25, 24]} />
          <meshStandardMaterial color="#1a1c1e" metalness={0.85} roughness={0.25} />
        </mesh>

        {/* Orange drive ring / collar */}
        <mesh position={[0, 6.5, 0]}>
          <cylinderGeometry args={[8, 8, 2.5, 24]} />
          <meshStandardMaterial color="#ff7a1a" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Tool (Teal Carbide End Mill) */}
        <mesh position={[0, -8, 0]}>
          <cylinderGeometry args={[3.5, 3.5, 26, 24]} />
          <meshStandardMaterial color="#005b60" metalness={0.9} roughness={0.2} />
        </mesh>

        {/* Helical Flutes details on cutter */}
        {Array.from({ length: 4 }).map((_, i) => (
          <mesh key={i} position={[0, -8, 0]} rotation={[0, (i * Math.PI) / 2, 0]}>
            <boxGeometry args={[7.2, 25, 0.4]} />
            <meshStandardMaterial color="#ff7a1a" roughness={0.3} />
          </mesh>
        ))}

        {/* Dynamic chip ejection sparks */}
        <group ref={chipsRef}>
          {Array.from({ length: 12 }).map((_, i) => (
            <mesh key={i} position={[0, -1000, 0]}>
              <sphereGeometry args={[0.7, 6, 6]} />
              <meshBasicMaterial color="#ffb77c" />
            </mesh>
          ))}
        </group>

        {/* Local Spindle Glow */}
        {spindleOn && (
          <pointLight color="#5de6ff" intensity={1.2} distance={50} />
        )}
      </group>

      <Grid
        infiniteGrid
        fadeDistance={400}
        fadeStrength={2.5}
        sectionSize={20}
        sectionColor="#00c8d7"
        cellColor="#1e293b"
      />
    </>
  );
}
