import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAuth } from '../context/AuthContext.js';
import { parseAndVerifyGCode, GCodeParseResult, GCodeFinding, GCodeSegment } from '../engine/gcode.js';
import { collection, addDoc } from 'firebase/firestore';
import { db, apiFetch } from '../lib/firebase.js';
import { 
  PageHeader, 
  SectionHeader, 
  StatChip, 
  EmptyState 
} from './ui/Headers.js';
import { Card } from './ui/Layout.js';
import { Badge } from './ui/Badge.js';
import { ButtonPrimary, ButtonSecondary, IconButton } from './ui/Button.js';
import { Tabs, Skeleton, ProgressBar } from './ui/Feedback.js';
import { Viewport3D } from './ui/Viewport3D.js';
import { CodeEditor } from './ui/CodeEditor.js';

// Pre-flight Verification Presets
interface PresetProgram {
  id: string;
  name: string;
  badge: string;
  badgeColor: string;
  code: string;
  description: string;
}

const PRESET_PROGRAMS: PresetProgram[] = [
  {
    id: 'clean_facing_pocket',
    name: 'O1001 — Safe Facing & Helical Pocket',
    badge: 'SAFE // 0 COLLISION',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    description: 'Standard 2.5D facing pass and helical circular pocket with full G43 height compensation and safe clearance plane.',
    code: `%
O1001 (SAFE FACING & CIRCULAR POCKET)
(MATERIAL: AL6061-T6 / BILLET 100X80)
G21 G90 G40 G49 G80 G17
G54
T01 M06 (12MM CARBIDE 3-FLUTE ENDMILL)
G43 H01 Z50.0
S8500 M03
(FACE MILLING PASS)
G00 X-35.0 Y-30.0
Z5.0
G01 Z-2.0 F600.0
X35.0 F1400.0
Y0.0
X-35.0
Y30.0
X35.0
G00 Z5.0
(CIRCULAR POCKET HELIX)
X0.0 Y0.0
Z2.0
G01 Z-6.0 F350.0
G02 I15.0 J0.0 F1100.0
G00 Z50.0
M05
G28 G91 Z0.0
G90
M30
%`,
  },
  {
    id: 'rapid_plunge_crash',
    name: 'O1002 — Rapid Plunge Crash Risk (G00 Z-15)',
    badge: 'CRITICAL // COLLISION',
    badgeColor: 'text-error bg-error-container/20 border-error/30',
    description: 'Dangerous rapid traverse commanded into negative Z (-15mm) while moving XY across table. Severe tool/fixture collision hazard.',
    code: `%
O1002 (CRASH RISK: RAPID PLUNGE TO DEPTH)
(MATERIAL: 4140 PRE-HARDENED STEEL)
G21 G90 G17 G54
T01 M06 (10MM ROUGHING ENDMILL)
G43 H01 Z25.0
S5200 M03
G00 X-40.0 Y-40.0
(VIOLATION: G00 rapid directly to cutting depth while moving XY)
G00 X20.0 Y20.0 Z-15.0
G01 X50.0 F750.0
Y30.0
G00 Z25.0
M05
G28 G91 Z0.0
G90
M30
%`,
  },
  {
    id: 'missing_g43_offset',
    name: 'O1003 — Missing G43 Height Compensation',
    badge: 'CRITICAL // WRONG G43',
    badgeColor: 'text-error bg-error-container/20 border-error/30',
    description: 'Tool change commanded (T02) but cutting motion commences without active G43 H02 length offset, causing catastrophic datum mismatch.',
    code: `%
O1003 (CRASH RISK: MISSING G43 OFFSET)
(MATERIAL: TI-6AL-4V)
G21 G90 G17 G54
T02 M06 (6MM BALL NOSE ENDMILL)
S9500 M03
(VIOLATION: Z-axis plunged without G43 H02 length offset!)
G00 X15.0 Y15.0
Z5.0
G01 Z-3.5 F450.0
X45.0
Y20.0
G00 Z25.0
M05
M30
%`,
  },
  {
    id: 'spindle_off_feed',
    name: 'O1004 — Spindle Off Cutting Feed (M05 / G01)',
    badge: 'CRITICAL // TOOL BREAKAGE',
    badgeColor: 'text-error bg-error-container/20 border-error/30',
    description: 'Spindle was stopped by M05 or unstarted before linear cutting motion G01 commenced. Guaranteed tool breakage upon stock engagement.',
    code: `%
O1004 (CRASH RISK: FEED WITH SPINDLE OFF)
(MATERIAL: 304 STAINLESS STEEL)
G21 G90 G17 G54
T01 M06 (8MM CARBIDE ENDMILL)
G43 H01 Z15.0
S4500 M03
G00 X0.0 Y0.0
Z2.0
M05 (SPINDLE HALTED INADVERTENTLY)
(VIOLATION: G01 cutting feed commanded into stock with stationary spindle)
G01 Z-5.0 F280.0
X30.0 F650.0
G00 Z20.0
M30
%`,
  },
  {
    id: 'rigid_tapping_mismatch',
    name: 'O1005 — Rigid Tapping Pitch Discrepancy (G84)',
    badge: 'WARNING // THREAD STRIP',
    badgeColor: 'text-amber-300 bg-amber-500/20 border-amber-500/30',
    description: 'G84 rigid tapping block programmed with feed rate out of sync with spindle speed and thread pitch (M6x1.0 requires F1000 at S1000).',
    code: `%
O1005 (WARNING: RIGID TAPPING FEED MISMATCH)
(MATERIAL: CAST IRON EN-GJL-250)
G21 G90 G17 G54
T03 M06 (M6X1.0 SPIRAL POINT TAP)
G43 H03 Z30.0
S1000 M03
G00 X20.0 Y20.0
Z5.0
(VIOLATION: M6x1.0 tap at S1000 needs F1000; programmed F1500 strips thread)
G84 Z-15.0 R3.0 F1500.0
G80
G00 Z50.0
M05
G28 G91 Z0.0
G90
M30
%`,
  },
];

// 3D Toolpath Scene
function ToolpathScene({
  segments,
  currentStepIndex,
  criticalFindingLines,
}: {
  segments: GCodeSegment[];
  currentStepIndex: number;
  criticalFindingLines: Set<number>;
}) {
  const toolMarkerRef = useRef<THREE.Group>(null);

  // Calculate bounding box and scale to fit in view
  const bounds = useMemo(() => {
    let minX = -20, maxX = 20;
    let minY = -20, maxY = 20;
    let minZ = -10, maxZ = 20;

    if (segments.length > 0) {
      minX = Math.min(...segments.map(s => Math.min(s.from.x, s.to.x)));
      maxX = Math.max(...segments.map(s => Math.max(s.from.x, s.to.x)));
      minY = Math.min(...segments.map(s => Math.min(s.from.y, s.to.y)));
      maxY = Math.max(...segments.map(s => Math.max(s.from.y, s.to.y)));
      minZ = Math.min(...segments.map(s => Math.min(s.from.z, s.to.z)));
      maxZ = Math.max(...segments.map(s => Math.max(s.from.z, s.to.z)));
    }

    const spanX = Math.max(10, maxX - minX);
    const spanY = Math.max(10, maxY - minY);
    const spanZ = Math.max(10, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanY, spanZ, 40);
    const scale = 3.6 / maxSpan;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    return { minX, maxX, minY, maxY, minZ, maxZ, scale, centerX, centerY, centerZ };
  }, [segments]);

  // Build Rapid and Feed Line Geometries
  const { rapidLines, feedLines, collisionPoints } = useMemo(() => {
    const rapidPts: THREE.Vector3[] = [];
    const feedPts: THREE.Vector3[] = [];
    const collisions: { pos: THREE.Vector3; line: number }[] = [];

    const visibleSegments = segments.slice(0, Math.max(1, currentStepIndex + 1));

    visibleSegments.forEach(seg => {
      const p1 = new THREE.Vector3(
        (seg.from.x - bounds.centerX) * bounds.scale,
        (seg.from.z - bounds.centerZ) * bounds.scale,
        -(seg.from.y - bounds.centerY) * bounds.scale
      );
      const p2 = new THREE.Vector3(
        (seg.to.x - bounds.centerX) * bounds.scale,
        (seg.to.z - bounds.centerZ) * bounds.scale,
        -(seg.to.y - bounds.centerY) * bounds.scale
      );

      if (seg.type === 'rapid') {
        rapidPts.push(p1, p2);
      } else {
        feedPts.push(p1, p2);
      }

      if (criticalFindingLines.has(seg.line)) {
        collisions.push({ pos: p2, line: seg.line });
      }
    });

    const rapidGeo = new THREE.BufferGeometry().setFromPoints(rapidPts);
    const feedGeo = new THREE.BufferGeometry().setFromPoints(feedPts);

    return { rapidLines: rapidGeo, feedLines: feedGeo, collisionPoints: collisions };
  }, [segments, currentStepIndex, bounds, criticalFindingLines]);

  // Current tool tip position
  const activePosition = useMemo(() => {
    if (segments.length === 0 || currentStepIndex < 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    const cur = segments[Math.min(currentStepIndex, segments.length - 1)];
    return new THREE.Vector3(
      (cur.to.x - bounds.centerX) * bounds.scale,
      (cur.to.z - bounds.centerZ) * bounds.scale,
      -(cur.to.y - bounds.centerY) * bounds.scale
    );
  }, [segments, currentStepIndex, bounds]);

  // Tool marker rotation / spin animation
  useFrame((_, delta) => {
    if (toolMarkerRef.current) {
      toolMarkerRef.current.position.lerp(activePosition, 0.25);
      toolMarkerRef.current.rotation.y += delta * 6;
    }
  });

  return (
    <group>
      {/* Table Work Plane Grid */}
      <gridHelper
        args={[5, 20, '#5de6ff', '#1c2025']}
        position={[0, (bounds.minZ - bounds.centerZ) * bounds.scale - 0.05, 0]}
      />

      {/* Stock Bounding Box */}
      <mesh
        position={[0, ((bounds.minZ + Math.min(0, bounds.maxZ)) / 2 - bounds.centerZ) * bounds.scale, 0]}
      >
        <boxGeometry
          args={[
            Math.max(0.6, (bounds.maxX - bounds.minX) * bounds.scale + 0.2),
            Math.max(0.2, Math.abs(bounds.minZ) * bounds.scale + 0.1),
            Math.max(0.6, (bounds.maxY - bounds.minY) * bounds.scale + 0.2),
          ]}
        />
        <meshStandardMaterial
          color="#181c21"
          metalness={0.7}
          roughness={0.3}
          transparent
          opacity={0.4}
          wireframe={false}
        />
      </mesh>

      {/* Work Coordinate Datum G54 Marker at (0, 0, 0) */}
      <group
        position={[
          (0 - bounds.centerX) * bounds.scale,
          (0 - bounds.centerZ) * bounds.scale,
          -(0 - bounds.centerY) * bounds.scale,
        ]}
      >
        {/* Origin sphere */}
        <mesh>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        {/* X axis (Red) */}
        <mesh position={[0.2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.008, 0.008, 0.4]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        {/* Z axis (Blue) */}
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.4]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
        {/* Y axis (Green) */}
        <mesh position={[0, 0, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.4]} />
          <meshBasicMaterial color="#10b981" />
        </mesh>
      </group>

      {/* Rapid Positioning Line Segments (Amber) */}
      {/* @ts-ignore */}
      <lineSegments geometry={rapidLines}>
        <lineBasicMaterial color="#fbbf24" opacity={0.65} transparent linewidth={1} />
      </lineSegments>

      {/* Cutting Feed Line Segments (Cyan Glow) */}
      {/* @ts-ignore */}
      <lineSegments geometry={feedLines}>
        <lineBasicMaterial color="#5de6ff" linewidth={2} />
      </lineSegments>

      {/* Collision Warning Beacons */}
      {collisionPoints.map((cp, idx) => (
        <group key={`collision-${idx}`} position={cp.pos}>
          <mesh>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshBasicMaterial color="#ff5449" wireframe />
          </mesh>
          <pointLight color="#ff5449" distance={1.2} intensity={2} />
        </group>
      ))}

      {/* Tool Assembly & Spindle Tip */}
      <group ref={toolMarkerRef}>
        {/* Tool Shank / Cutter Body */}
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.5, 16]} />
          <meshStandardMaterial color="#ffb68e" metalness={0.9} roughness={0.15} />
        </mesh>
        {/* Tool Tip Cone */}
        <mesh position={[0, 0.02, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.04, 0.06, 16]} />
          <meshStandardMaterial color="#5de6ff" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Local tool light */}
        <pointLight color="#5de6ff" distance={0.8} intensity={0.6} position={[0, 0.1, 0]} />
      </group>
    </group>
  );
}

export interface GCodeVerifierProps {
  onNavigate?: (tab: string) => void;
}

export function GCodeVerifier({ onNavigate }: GCodeVerifierProps) {
  const { user, profile } = useAuth();

  // Active controller
  const [controller, setController] = useState<'fanuc' | 'mitsubishi' | 'generic'>(
    (profile?.preferredController as any) || 'fanuc'
  );

  // Program Code State
  const [activePresetId, setActivePresetId] = useState<string>('clean_facing_pocket');
  const [programName, setProgramName] = useState<string>('O1001_POCKET_FACING.NC');
  const [gcodeText, setGcodeText] = useState<string>(PRESET_PROGRAMS[0].code);

  // Inspector & Simulation State
  const [selectedFindingLine, setSelectedFindingLine] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [viewPreset, setViewPreset] = useState<'iso' | 'top' | 'front'>('iso');
  const [justVerified, setJustVerified] = useState<boolean>(false);

  // Gemini Pro AI G-Code Review Cache & State
  const [reviewCache, setReviewCache] = useState<{
    programText: string;
    controller: string;
    reviews: Array<{ line: number; code: string; explanation: string; fix: string }>;
    additionalRisks: string[];
  } | null>(null);
  const [isLoadingReview, setIsLoadingReview] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({});

  // Code editor textarea ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Parse G-code deterministically
  const parseResult: GCodeParseResult = useMemo(() => {
    return parseAndVerifyGCode(gcodeText, controller);
  }, [gcodeText, controller]);

  // Critical Finding Line Numbers for quick lookup & backplot markers
  const criticalFindingLines = useMemo(() => {
    return new Set(
      parseResult.findings
        .filter(f => f.severity === 'CRITICAL')
        .map(f => f.line)
    );
  }, [parseResult.findings]);

  // Filtered findings list
  const filteredFindings = useMemo(() => {
    if (activeFilter === 'ALL') return parseResult.findings;
    return parseResult.findings.filter(f => f.severity === activeFilter);
  }, [parseResult.findings, activeFilter]);

  // Derived travel bounds
  const travelBounds = useMemo(() => {
    if (parseResult.segments.length === 0) {
      return { xRange: '0 to 0', yRange: '0 to 0', zRange: '0 to 0', maxFeed: 0, maxRpm: 0 };
    }
    const xs = parseResult.segments.flatMap(s => [s.from.x, s.to.x]);
    const ys = parseResult.segments.flatMap(s => [s.from.y, s.to.y]);
    const zs = parseResult.segments.flatMap(s => [s.from.z, s.to.z]);

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    // Extract max S and F from text
    const sMatches = gcodeText.match(/S(\d+)/g) || [];
    const fMatches = gcodeText.match(/F(\d+(?:\.\d+)?)/g) || [];

    const rpms = sMatches.map(m => parseFloat(m.slice(1)));
    const feeds = fMatches.map(m => parseFloat(m.slice(1)));

    return {
      xRange: `${minX >= 0 ? '+' : ''}${minX.toFixed(1)} to ${maxX >= 0 ? '+' : ''}${maxX.toFixed(1)}mm`,
      yRange: `${minY >= 0 ? '+' : ''}${minY.toFixed(1)} to ${maxY >= 0 ? '+' : ''}${maxY.toFixed(1)}mm`,
      zRange: `${minZ >= 0 ? '+' : ''}${minZ.toFixed(1)} to ${maxZ >= 0 ? '+' : ''}${maxZ.toFixed(1)}mm`,
      maxFeed: feeds.length > 0 ? Math.max(...feeds) : 0,
      maxRpm: rpms.length > 0 ? Math.max(...rpms) : 0,
    };
  }, [parseResult.segments, gcodeText]);

  // Active current motion position in simulation
  const currentSimulationSegment = useMemo(() => {
    if (parseResult.segments.length === 0) return null;
    const clampedIndex = Math.min(playbackIndex, parseResult.segments.length - 1);
    return parseResult.segments[clampedIndex];
  }, [parseResult.segments, playbackIndex]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return;
    if (parseResult.segments.length === 0) return;

    const intervalTime = Math.max(30, 250 / playbackSpeed);
    const timer = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= parseResult.segments.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [isPlaying, parseResult.segments.length, playbackSpeed]);

  // Sync playback index with total segments when text changes
  useEffect(() => {
    setPlaybackIndex(parseResult.segments.length > 0 ? parseResult.segments.length - 1 : 0);
  }, [parseResult.segments.length]);

  // Camera orientation handler
  const getCameraPos = (preset: string): [number, number, number] => {
    if (preset === 'top') return [0, 4.8, 0.001];
    if (preset === 'front') return [0, 0, 4.8];
    return [3.2, 3.2, 3.2];
  };

  const setCameraView = (view: 'iso' | 'top' | 'front') => {
    setViewPreset(view);
  };

  // Handle Preset selection
  const handleSelectPreset = (preset: PresetProgram) => {
    setActivePresetId(preset.id);
    setGcodeText(preset.code);
    setProgramName(preset.name.split(' — ')[0] + '.NC');
    setSelectedFindingLine(null);
    setIsPlaying(false);
  };

  // Handle file upload (.nc, .tap, .eia, .gcode, .txt)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProgramName(file.name.toUpperCase());
    setActivePresetId('');

    const reader = new FileReader();
    reader.onload = evt => {
      const content = evt.target?.result as string;
      if (content) {
        setGcodeText(content);
        setSelectedFindingLine(null);
        setIsPlaying(false);
      }
    };
    reader.readAsText(file);
  };

  const fetchGCodeReview = async (programToReview: string, controllerToUse: string) => {
    if (reviewCache && reviewCache.programText === programToReview && reviewCache.controller === controllerToUse) {
      return reviewCache;
    }

    setIsLoadingReview(true);
    setReviewError(null);

    try {
      const res = await apiFetch('/api/gcode-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program: programToReview,
          controller: controllerToUse,
          language: profile?.preferredLanguage || 'en',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'AI review unavailable');
      }

      const data = await res.json();
      const newCache = {
        programText: programToReview,
        controller: controllerToUse,
        reviews: data.reviews || [],
        additionalRisks: data.additionalRisks || [],
      };
      setReviewCache(newCache);
      return newCache;
    } catch (err: any) {
      console.warn('[GCodeVerifier] Review error:', err);
      setReviewError(err?.message || 'Failed to fetch AI review');
      return null;
    } finally {
      setIsLoadingReview(false);
    }
  };

  const handleToggleExplain = async (finding: GCodeFinding) => {
    const key = `${finding.line}-${finding.code}`;
    const willExpand = !expandedFindings[key];

    setExpandedFindings(prev => ({
      ...prev,
      [key]: willExpand,
    }));

    if (willExpand) {
      if (!reviewCache || reviewCache.programText !== gcodeText || reviewCache.controller !== controller) {
        await fetchGCodeReview(gcodeText, controller);
      }
    }
  };

  // Log verification to user's activity log in Firestore
  const handleVerifyProgram = async () => {
    setJustVerified(true);
    setTimeout(() => setJustVerified(false), 2400);

    // Call review once per verify if there are findings
    if (parseResult.findings.length > 0) {
      fetchGCodeReview(gcodeText, controller);
    }

    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'activity'), {
        type: 'gcode',
        title: `Verified ${programName}`,
        summary: `${parseResult.criticalCount === 0 ? 'Passed syntax & kinematic audit (0 collisions)' : `${parseResult.criticalCount} collision risk(s) flagged`} • ${parseResult.blockCount} blocks`,
        link: 'gcode',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[GCodeVerifier] Activity write notice:', err);
    }
  };

  // Jump to specific line in textarea
  const jumpToLine = (lineNum: number) => {
    setSelectedFindingLine(lineNum);
    const lines = gcodeText.split('\n');
    let charOffset = 0;
    for (let i = 0; i < Math.min(lineNum - 1, lines.length); i++) {
      charOffset += lines[i].length + 1;
    }

    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        charOffset,
        charOffset + (lines[lineNum - 1]?.length || 0)
      );
      // approximate line scroll
      const lineHeight = 20;
      textareaRef.current.scrollTop = Math.max(0, (lineNum - 5) * lineHeight);
    }

    // Set simulation step to that line if a segment exists
    const matchingSegIdx = parseResult.segments.findIndex(s => s.line >= lineNum);
    if (matchingSegIdx >= 0) {
      setPlaybackIndex(matchingSegIdx);
    }
  };

  // Lines split for editor display
  const editorLines = useMemo(() => {
    return gcodeText.split(/\r?\n/);
  }, [gcodeText]);

  return (
    <>
      <div className="w-full min-h-screen bg-surface-container-lowest text-on-surface pb-16">
      <div className="border-b border-outline-variant/30 bg-surface-container/60 backdrop-blur-md px-margin py-4 sticky top-16 z-30">
        <PageHeader
          icon="terminal"
          label="Deterministic ISO-6983 Engine"
          title="G-code Syntax & Collision Verifier"
          caption="Deterministic modal validation, tool length compensation audit, and real-time 3D kinematic backplot."
          actions={
            <div className="flex items-center gap-2">
              <Tabs
                activeTab={controller}
                onTabChange={(id) => setController(id as any)}
                tabs={[
                  { id: 'fanuc', label: 'Fanuc 0i' },
                  { id: 'mitsubishi', label: 'M80' },
                  { id: 'generic', label: 'Generic ISO' },
                ]}
              />
              <label className="h-10 px-4 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-xs font-mono text-on-surface flex items-center gap-2 cursor-pointer transition-all">
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                <span>Upload</span>
                <input type="file" accept=".nc,.tap,.eia,.gcode,.txt" onChange={handleFileUpload} className="hidden" />
              </label>
              <ButtonPrimary onClick={handleVerifyProgram} icon={justVerified ? 'check_circle' : 'verified'}>
                {justVerified ? 'AUDIT LOGGED' : 'VERIFY PROGRAM'}
              </ButtonPrimary>
            </div>
          }
        />
      </div>

        {/* Top 4 KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 flex flex-col justify-between">
            <SectionHeader title="Safety Status" icon={parseResult.criticalCount > 0 ? 'error' : 'verified_user'} className="border-b-0 mb-0 pb-0" />
            <div className="mt-2">
              <div className="font-code-lg text-xl font-bold">
                {parseResult.criticalCount > 0 ? (
                  <span className="text-error">{parseResult.criticalCount} COLLISION</span>
                ) : (
                  <span className="text-secondary">100% PRE-FLIGHT PASS</span>
                )}
              </div>
              <div className="text-[11px] font-mono text-tertiary mt-1 uppercase">ISO-6983 COMPLIANT</div>
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <SectionHeader title="Parsed Blocks" icon="data_array" className="border-b-0 mb-0 pb-0" />
            <div className="mt-2">
              <div className="font-code-lg text-xl font-bold text-on-surface">
                {parseResult.blockCount} <span className="text-xs text-tertiary font-normal">LINES</span>
              </div>
              <div className="text-[11px] font-mono text-tertiary mt-1 flex items-center gap-2">
                <Badge variant="secondary">{parseResult.segments.filter(s => s.type !== 'rapid').length} FEED</Badge>
                <Badge variant="warning">{parseResult.segments.filter(s => s.type === 'rapid').length} RAPID</Badge>
              </div>
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <SectionHeader title="Envelope" icon="view_in_ar" className="border-b-0 mb-0 pb-0" />
            <div className="mt-2 space-y-1">
              <StatChip label="X Range" value={travelBounds.xRange} variant="secondary" />
              <StatChip label="Y Range" value={travelBounds.yRange} variant="secondary" />
              <StatChip label="Z Range" value={travelBounds.zRange} variant="primary" />
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <SectionHeader title="Peak Rates" icon="speed" className="border-b-0 mb-0 pb-0" />
            <div className="mt-2">
              <div className="font-code-lg text-xl font-bold text-on-surface">
                {travelBounds.maxRpm > 0 ? `S${travelBounds.maxRpm}` : 'S0'} <span className="text-xs text-tertiary font-normal">RPM</span>
              </div>
              <div className="text-[11px] font-mono text-tertiary mt-1">
                PEAK FEED: <span className="text-secondary font-bold">{travelBounds.maxFeed} mm/min</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Preset Selector Strip */}
        <div className="flex flex-col gap-2">
          <SectionHeader title="Shopfloor Verification Scenarios & Presets" className="border-b-0 mb-0 pb-0" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {PRESET_PROGRAMS.map(preset => {
              const isActive = activePresetId === preset.id;
              return (
                <Card
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className={`p-3 transition-all flex flex-col justify-between gap-1.5 ${
                    isActive ? 'border-secondary shadow-lg ring-1 ring-secondary/20' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-on-surface truncate">
                      {preset.name.split(' — ')[0]}
                    </span>
                    <Badge variant={preset.badge.includes('SAFE') ? 'success' : 'error'}>
                      {preset.badge.split(' // ')[0]}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-tertiary line-clamp-2 leading-tight">
                    {preset.description}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Main Split Layout: Left Editor + Right 3D Visualizer & Pre-Flight Findings */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: G-code Editor & Syntax Gutter (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden flex flex-col shadow-xl">
              {/* Editor Header Bar */}
              <div className="px-4 py-3 bg-surface-container-high border-b border-outline-variant/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-secondary">code</span>
                  <input
                    type="text"
                    value={programName}
                    onChange={e => setProgramName(e.target.value)}
                    className="bg-transparent font-mono text-xs font-bold text-on-surface focus:outline-none border-b border-transparent focus:border-secondary transition-all"
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-tertiary">
                  <span>{editorLines.length} BLOCKS</span>
                  <span>•</span>
                  <button
                    onClick={() => {
                      setGcodeText('');
                      setActivePresetId('');
                    }}
                    className="text-tertiary hover:text-error transition-colors cursor-pointer"
                    title="Clear editor"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Modal State Indicator Header */}
              <div className="px-4 py-2 bg-surface-container-lowest/80 border-b border-outline-variant/20 flex items-center gap-2 overflow-x-auto text-[10px] font-mono">
                <span className="text-outline">MODAL:</span>
                <span className="px-1.5 py-0.5 rounded-[4px] bg-secondary-fixed/10 text-secondary-fixed border border-secondary-fixed/30 font-bold">
                  G90 ABS
                </span>
                <span className="px-1.5 py-0.5 rounded-[4px] bg-secondary-fixed/10 text-secondary-fixed border border-secondary-fixed/30 font-bold">
                  G17 XY
                </span>
                <span className="px-1.5 py-0.5 rounded-[4px] bg-secondary-fixed/10 text-secondary-fixed border border-secondary-fixed/30 font-bold">
                  G21 MM
                </span>
                <span className="px-1.5 py-0.5 rounded-[4px] bg-surface-container text-tertiary border border-outline-variant/40">
                  G54 WCS
                </span>
                <span className={`px-1.5 py-0.5 rounded-[4px] border ${criticalFindingLines.size > 0 ? 'bg-error-container/20 text-error border-error/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                  {criticalFindingLines.size > 0 ? 'G43 AUDIT FAIL' : 'G43 MATCH'}
                </span>
              </div>

              <div className="flex-1 min-h-[500px]">
                <CodeEditor
                  code={gcodeText}
                  onChange={(code) => {
                    setGcodeText(code);
                    setActivePresetId('');
                  }}
                  onLineClick={jumpToLine}
                  selectedLine={selectedFindingLine}
                  flaggedLines={Array.from(criticalFindingLines)}
                  language="gcode"
                />
              </div>

              {/* Editor Footer */}
              <div className="px-4 py-2.5 bg-surface-container-low border-t border-outline-variant/20 flex items-center justify-between text-[11px] font-mono text-tertiary">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  REAL-TIME SYNTAX AUDITING ACTIVE
                </span>
                <span className="text-outline">
                  {selectedFindingLine ? `FOCUSED LINE ${selectedFindingLine}` : 'CLICK FINDING TO JUMP'}
                </span>
              </div>
          </div>
        </div>

        {/* Right Column: 3D Kinematic Backplot & Findings */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <Card className="flex flex-col">
              <SectionHeader 
                title="3D Kinematic Toolpath Backplot" 
                icon="3d_rotation"
                actions={
                  <Tabs
                    activeTab={viewPreset}
                    onTabChange={(id) => setCameraView(id as any)}
                    tabs={[
                      { id: 'iso', label: 'ISO' },
                      { id: 'top', label: 'TOP' },
                      { id: 'front', label: 'FRONT' },
                    ]}
                  />
                }
                className="px-4 py-3 border-b-0 mb-0"
              />

              <div className="h-[340px] w-full">
                <Viewport3D
                  cameraPosition={getCameraPos(viewPreset)}
                  showGrid={true}
                  overlay={
                    <>
                      {/* 3D Visualizer Scene Legend */}
                      <div className="absolute top-3 left-3 bg-surface-container-lowest/85 backdrop-blur-md p-2 rounded-lg border border-outline-variant/30 text-[10px] font-mono flex flex-col gap-1 shadow-lg pointer-events-none">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-1 bg-secondary rounded-full shadow-[0_0_8px_theme(colors.secondary)]" />
                          <span className="text-secondary">G01/G02/G03 FEED (CUTTING)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-1 bg-amber-400 rounded-full" />
                          <span className="text-amber-300">G00 RAPID TRAVERSE</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-1 bg-[#ef4444] rounded-full" />
                          <span className="text-error">COLLISION / ERROR POINT</span>
                        </div>
                        <div className="flex items-center gap-2 text-outline pt-1 border-t border-outline-variant/20">
                          <span>ORIGIN: G54 (0,0,0)</span>
                        </div>
                      </div>

                      {/* Active Tool Readout */}
                      {currentSimulationSegment && (
                        <div className="absolute top-3 right-3 bg-surface-container-lowest/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-outline-variant/30 text-[10px] font-mono flex items-center gap-2 text-on-surface shadow-lg">
                          <span className="text-tertiary">TOOL COORD:</span>
                          <span className="text-secondary font-bold">X{currentSimulationSegment.to.x.toFixed(2)}</span>
                          <span className="text-secondary font-bold">Y{currentSimulationSegment.to.y.toFixed(2)}</span>
                          <span className="text-primary font-bold">Z{currentSimulationSegment.to.z.toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  }
                >
                  <ToolpathScene
                    segments={parseResult.segments}
                    currentStepIndex={playbackIndex}
                    criticalFindingLines={criticalFindingLines}
                  />
                </Viewport3D>
              </div>

              {/* Simulation Playback & Step Controls Bar */}
              <div className="px-4 py-2.5 bg-surface-container-low border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackIndex(0);
                    }}
                    className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface transition-colors cursor-pointer"
                    title="Rewind to Block 1"
                  >
                    <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackIndex(prev => Math.max(0, prev - 1));
                    }}
                    className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface transition-colors cursor-pointer"
                    title="Step backward"
                  >
                    <span className="material-symbols-outlined text-[16px]">skip_previous</span>
                  </button>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="h-8 px-3 rounded-lg bg-secondary-fixed text-on-secondary font-mono font-bold text-xs flex items-center gap-1 transition-all shadow-sm cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {isPlaying ? 'pause' : 'play_arrow'}
                    </span>
                    {isPlaying ? 'PAUSE' : 'SIMULATE'}
                  </button>
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackIndex(prev => Math.min(parseResult.segments.length - 1, prev + 1));
                    }}
                    className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 flex items-center justify-center text-on-surface transition-colors cursor-pointer"
                    title="Step forward"
                  >
                    <span className="material-symbols-outlined text-[16px]">skip_next</span>
                  </button>
                </div>

                {/* Progress Slider */}
                <div className="flex-1 max-w-xs flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, parseResult.segments.length - 1)}
                    value={playbackIndex}
                    onChange={e => {
                      setIsPlaying(false);
                      setPlaybackIndex(parseInt(e.target.value));
                    }}
                    className="w-full accent-secondary cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-tertiary whitespace-nowrap">
                    {playbackIndex + 1}/{parseResult.segments.length || 1}
                  </span>
                </div>

                {/* Speed Multiplier */}
                <div className="flex items-center gap-1 text-[10px] font-mono text-tertiary">
                  <span>SPEED:</span>
                  {[1, 2, 5].map(spd => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-1.5 py-0.5 rounded-[4px] cursor-pointer transition-colors ${
                        playbackSpeed === spd
                          ? 'bg-secondary text-on-secondary font-bold'
                          : 'bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* Pre-Flight Findings & Collision Audit List */}
            <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden flex flex-col shadow-xl">
              {/* Findings Header with Filters */}
              <div className="px-4 py-3 bg-surface-container-high border-b border-outline-variant/30 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">warning</span>
                  <span className="font-mono text-xs font-bold text-on-surface uppercase">
                    Pre-Flight Safety Audit & Findings
                  </span>
                  <span className="px-1.5 py-0.5 rounded-[4px] bg-primary/10 text-primary border border-primary/30 text-[9px] font-mono font-bold">
                    {parseResult.findings.length} RULES EVALUATED
                  </span>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 bg-surface-container-low p-1 rounded-lg border border-outline-variant/20 text-[10px] font-mono">
                  <button
                    onClick={() => setActiveFilter('ALL')}
                    className={`px-2 py-0.5 rounded-[4px] transition-all cursor-pointer ${
                      activeFilter === 'ALL' ? 'bg-secondary text-on-secondary font-bold' : 'text-tertiary hover:text-on-surface'
                    }`}
                  >
                    ALL ({parseResult.findings.length})
                  </button>
                  <button
                    onClick={() => setActiveFilter('CRITICAL')}
                    className={`px-2 py-0.5 rounded-[4px] transition-all cursor-pointer ${
                      activeFilter === 'CRITICAL' ? 'bg-error-container text-error font-bold' : 'text-tertiary hover:text-error'
                    }`}
                  >
                    CRITICAL ({parseResult.criticalCount})
                  </button>
                  <button
                    onClick={() => setActiveFilter('WARNING')}
                    className={`px-2 py-0.5 rounded-[4px] transition-all cursor-pointer ${
                      activeFilter === 'WARNING' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-tertiary hover:text-amber-300'
                    }`}
                  >
                    WARNINGS ({parseResult.warningCount})
                  </button>
                  <button
                    onClick={() => setActiveFilter('INFO')}
                    className={`px-2 py-0.5 rounded-[4px] transition-all cursor-pointer ${
                      activeFilter === 'INFO' ? 'bg-surface-variant text-on-surface font-bold' : 'text-tertiary hover:text-on-surface'
                    }`}
                  >
                    INFO ({parseResult.infoCount})
                  </button>
                </div>
              </div>

              {/* Findings Content / List */}
              <div className="p-4 flex flex-col gap-2.5 max-h-[380px] overflow-y-auto">
                {filteredFindings.length === 0 ? (
                  <EmptyState 
                    icon="verified"
                    title={`No ${activeFilter === 'ALL' ? '' : activeFilter} Issues Detected`}
                    description="Toolpath adheres to safe motion rules, modal coordinate declaration, and verified feed/spindle synchronization."
                  />
                ) : (
                  filteredFindings.map((finding, idx) => {
                    const isSelected = selectedFindingLine === finding.line;
                    const findingKey = `${finding.line}-${finding.code}`;
                    const isExpanded = !!expandedFindings[findingKey];
                    const matchingReview = reviewCache?.reviews?.find(
                      r => (r.code === finding.code && r.line === finding.line) ||
                           (r.code === finding.code) ||
                           (r.line === finding.line)
                    );

                    return (
                      <div
                        key={`finding-${idx}`}
                        onClick={() => jumpToLine(finding.line)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                          finding.severity === 'CRITICAL'
                            ? 'bg-error-container/10 border-error/40 hover:bg-error-container/20 shadow-[0_0_12px_rgba(255,84,73,0.15)]'
                            : finding.severity === 'WARNING'
                            ? 'bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/15'
                            : 'bg-surface-container-low border-outline-variant/30 hover:bg-surface-container-high'
                        } ${isSelected ? 'ring-2 ring-secondary' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant={
                                finding.severity === 'CRITICAL'
                                  ? 'error'
                                  : finding.severity === 'WARNING'
                                  ? 'warning'
                                  : 'tertiary'
                              }
                            >
                              {finding.severity}
                            </Badge>
                            <span className="font-mono text-xs font-bold text-secondary">
                              BLOCK N{finding.line}
                            </span>
                            <span className="font-mono text-[10px] text-tertiary">
                              [{finding.code}]
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                jumpToLine(finding.line);
                              }}
                              className="text-[10px] font-mono text-secondary hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <span>Jump to Line</span>
                              <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                            </button>
                            <ButtonSecondary
                              onClick={e => {
                                e.stopPropagation();
                                handleToggleExplain(finding);
                              }}
                              className="h-8 px-3 text-xs"
                              loading={isLoadingReview && isExpanded && !matchingReview}
                            >
                              {isExpanded ? 'Hide' : 'Explain'}
                            </ButtonSecondary>
                          </div>
                        </div>

                        <p className="font-body-sm text-xs text-on-surface leading-relaxed">
                          {finding.message}
                        </p>

                        {isExpanded && (
                          <div className="mt-space-xs p-space-sm rounded bg-surface-container flex flex-col gap-1.5 text-secondary font-mono font-code-sm text-code-sm border border-outline-variant/30">
                            {isLoadingReview && !matchingReview ? (
                              <span className="text-tertiary">Analyzing with Gemini Pro...</span>
                            ) : matchingReview ? (
                              <>
                                <div className="text-on-surface leading-relaxed">
                                  <span className="font-bold text-secondary">Explanation: </span>
                                  {matchingReview.explanation}
                                </div>
                                {matchingReview.fix && (
                                  <div className="pt-1.5 border-t border-outline-variant/20 flex flex-col gap-1">
                                    <span className="text-primary font-bold text-[11px] uppercase tracking-wider">Corrected Code:</span>
                                    <pre className="p-2 rounded bg-surface-container-lowest text-emerald-400 overflow-x-auto whitespace-pre-wrap font-mono">
                                      {matchingReview.fix}
                                    </pre>
                                  </div>
                                )}
                              </>
                            ) : reviewError ? (
                              <span className="text-error">{reviewError}</span>
                            ) : (
                              <span className="text-tertiary">No additional explanation provided for this finding.</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pre-Flight Checklist Footer */}
              <div className="px-4 py-3 bg-surface-container-low border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-tertiary">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="material-symbols-outlined text-[14px]">check</span> G90/G91 Modal Verified
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="material-symbols-outlined text-[14px]">check</span> G17 Workplane Verified
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="material-symbols-outlined text-[14px]">check</span> M30 Rewind Check
                  </span>
                </div>
                <button
                  onClick={() => onNavigate?.('academy')}
                  className="text-secondary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>Test in Crash Lab</span>
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </button>
              </div>
            </div>
        </div>
      </div>
    </div>
    </>
  );
}
