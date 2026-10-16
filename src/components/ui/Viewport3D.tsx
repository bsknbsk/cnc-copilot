import React, { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, PerspectiveCamera, GizmoHelper, GizmoViewport } from '@react-three/drei';

function CameraUpdater({ position }: { position: [number, number, number] }) {
  const { camera, controls } = useThree();
  
  useEffect(() => {
    camera.position.set(...position);
    if (controls) {
      (controls as any).target.set(0, 0, 0);
      (controls as any).update();
    }
  }, [position, camera, controls]);
  
  return null;
}

interface Viewport3DProps {
  children: React.ReactNode;
  cameraPosition?: [number, number, number];
  gridSize?: number;
  showGrid?: boolean;
  overlay?: React.ReactNode;
  className?: string;
}

export function Viewport3D({ 
  children, 
  cameraPosition = [150, 150, 150], 
  gridSize = 200, 
  showGrid = true, 
  overlay,
  className = "bg-slate-100"
}: Viewport3DProps) {
  return (
    <div className={`w-full h-full min-h-[400px] rounded-xl border border-outline-variant/20 overflow-hidden relative ${className}`}>
      <Canvas shadows gl={{ antialias: true, alpha: true }} camera={{ fov: 45 }}>
        <PerspectiveCamera makeDefault position={cameraPosition} />
        <CameraUpdater position={cameraPosition} />
        
        {/* Shared Industrial Lighting */}
        <ambientLight intensity={0.7} />
        <spotLight position={[100, 200, 100]} angle={0.15} penumbra={1} intensity={1.5} castShadow />
        <pointLight position={[-100, -100, -100]} intensity={0.8} />

        {showGrid && (
          <Grid
            infiniteGrid
            fadeDistance={500}
            fadeStrength={5}
            sectionSize={10}
            sectionColor="#94a3b8"
            cellColor="#cbd5e1"
          />
        )}

        <Suspense fallback={null}>
          {children}
        </Suspense>

        <OrbitControls makeDefault />

        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ff7a1a', '#00cbe6', '#ffb68e']} labelColor="white" />
        </GizmoHelper>
      </Canvas>
      {overlay}
    </div>
  );
}
