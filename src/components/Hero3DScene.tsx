import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function CutterScene() {
  const groupRef = useRef<THREE.Group>(null);
  const toolRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3;
    }
    if (toolRef.current) {
      toolRef.current.rotation.y += delta * 4.0;
    }
  });

  // Toolpath line points
  const points = React.useMemo(() => [
    new THREE.Vector3(-2.0, 0.9, -1.2),
    new THREE.Vector3(1.8, 0.9, -1.2),
    new THREE.Vector3(1.8, 0.9, 1.2),
    new THREE.Vector3(-1.8, 0.9, 1.2),
    new THREE.Vector3(-1.8, 0.9, 0.0),
    new THREE.Vector3(0.0, 0.9, 0.0),
  ], []);

  const lineGeometry = React.useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  return (
    <group ref={groupRef}>
      {/* Aluminum Workpiece Stock (Box) */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[4.5, 1.6, 3.2]} />
        <meshStandardMaterial
          color="#8B98A5"
          metalness={0.85}
          roughness={0.25}
        />
      </mesh>

      {/* Fixture Vise Base */}
      <mesh position={[0, -1.0, 0]}>
        <boxGeometry args={[5.2, 0.4, 3.8]} />
        <meshStandardMaterial color="#1F2A37" metalness={0.6} roughness={0.6} />
      </mesh>

      {/* Orange Toolpath Trajectory Line */}
      {/* @ts-ignore */}
      <line geometry={lineGeometry}>
        <lineBasicMaterial color="#FF7A1A" linewidth={2} />
      </line>

      {/* Rotating Spindle Tool Assembly */}
      <group position={[0, 1.4, 0]}>
        <group ref={toolRef}>
          {/* Toolholder Body */}
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.7, 0.9, 1.8, 24]} />
            <meshStandardMaterial color="#262A30" metalness={0.8} roughness={0.3} />
          </mesh>

          {/* Safety Orange Collet Ring */}
          <mesh position={[0, 0.7, 0]}>
            <cylinderGeometry args={[0.6, 0.65, 0.3, 24]} />
            <meshStandardMaterial color="#FF7A1A" metalness={0.5} roughness={0.3} />
          </mesh>

          {/* Solid Carbide End Mill Flute */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.22, 0.22, 0.9, 16]} />
            <meshStandardMaterial color="#22D3EE" metalness={0.95} roughness={0.15} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export function Hero3DScene() {
  return (
    <div className="w-full h-[320px] sm:h-[400px] lg:h-[460px] relative rounded-xl overflow-hidden glass-panel">
      <div className="absolute top-3 left-3 z-10 px-2 py-1 rounded bg-[#0B0F14]/80 border border-[#1F2A37] text-[11px] font-mono text-[#22D3EE] flex items-center gap-1.5 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE] animate-pulse"></span>
        KINEMATIC TWIN • 6061-T6
      </div>
      <Canvas
        camera={{ position: [5.5, 4.5, 6.0], fov: 42 }}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 15, 8]} intensity={1.2} />
        <pointLight position={[-6, 8, -4]} intensity={0.8} color="#FF7A1A" />
        <pointLight position={[0, 4, 0]} intensity={1.0} color="#22D3EE" />
        <CutterScene />
        <OrbitControls enableZoom={false} maxPolarAngle={Math.PI / 2.1} minPolarAngle={Math.PI / 6} />
      </Canvas>
    </div>
  );
}
