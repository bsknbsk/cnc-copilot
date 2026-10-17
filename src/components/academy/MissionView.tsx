import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { apiFetch } from '../../lib/firebase.js';
import { PageHeader, SectionHeader, EmptyState } from '../ui/Headers.js';
import { Card } from '../ui/Layout.js';
import { Tabs } from '../ui/Feedback.js';
import { ButtonPrimary, ButtonSecondary, ButtonDanger } from '../ui/Button.js';
import { CodeEditor } from '../ui/CodeEditor.js';
import { Viewport3D } from '../ui/Viewport3D.js';
import { ACADEMY_MISSIONS, CollisionEvent, calculateMissionXP } from '../../engine/crash.js';
import { MachineScene } from './MachineScene.js';
import { InstructorPanel } from './InstructorPanel.js';
import { parseAndVerifyGCode } from '../../engine/gcode.js';

interface MissionViewProps {
  missionId: string;
  onBack: () => void;
  onNavigate: (tab: string, state?: any) => void;
}

export function MissionView({ missionId, onBack, onNavigate }: MissionViewProps) {
  const { user, profile } = useAuth();
  const mission = useMemo(() => ACADEMY_MISSIONS.find((m) => m.id === missionId), [missionId]);

  const sessionIdRef = useRef<string>(`session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const [code, setCode] = useState(mission?.initialCode || '');
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [collision, setCollision] = useState<CollisionEvent | null>(null);
  const [isPassed, setIsPassed] = useState(false);
  const [serverResult, setServerResult] = useState<any>(null);
  const serverEvalRef = useRef<any>(null);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [cameraShake, setCameraShake] = useState(false);

  // Audio Context for metallic noise
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Reset mission code and session when missionId changes
    if (mission) {
      setCode(mission.initialCode);
      sessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setPlaybackIndex(-1);
      setIsPlaying(false);
      setCollision(null);
      setIsPassed(false);
      setServerResult(null);
      serverEvalRef.current = null;
      setHintsRevealed(0);
    }
  }, [missionId, mission]);

  const playCrashSound = () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseBuffer.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start();
    } catch (e) {
      console.warn('Audio failed:', e);
    }
  };

  const triggerShake = () => {
    setCameraShake(true);
    setTimeout(() => setCameraShake(false), 400);
  };

  // Parse G-code for simulation trajectory
  const parseResult = useMemo(() => {
    return parseAndVerifyGCode(code, profile?.preferredController || 'fanuc');
  }, [code, profile?.preferredController]);

  // Modal state tracker for collision check
  const modalTracker = useMemo(() => {
    return (currentLine: number) => {
      const lines = code.split('\n');
      let spindleOn = false;
      let toolLengthComp = false;
      let tapMode = false;
      let feed = 0;
      let rpm = 0;

      for (let i = 0; i < lines.length; i++) {
        if (i + 1 > currentLine) break;
        const l = lines[i].toUpperCase();
        if (l.includes('M03') || l.includes('M3')) spindleOn = true;
        if (l.includes('M05') || l.includes('M5')) spindleOn = false;
        if (l.includes('G43')) toolLengthComp = true;
        if (l.includes('G49')) toolLengthComp = false;
        if (l.includes('M29')) tapMode = true;
        if (l.includes('G80')) tapMode = false;

        const fMatch = l.match(/F(\d+(\.\d+)?)/);
        if (fMatch) feed = parseFloat(fMatch[1]);

        const sMatch = l.match(/S(\d+(\.\d+)?)/);
        if (sMatch) rpm = parseFloat(sMatch[1]);
      }

      return { spindleOn, toolLengthComp, tapMode, feed, rpm, program: code, pitch: mission?.pitch };
    };
  }, [code, mission]);

  // Server-authoritative run simulation trigger
  const handleRunSimulation = async () => {
    if (!mission || isEvaluating) return;

    setIsEvaluating(true);
    setCollision(null);
    setIsPassed(false);
    setPlaybackIndex(-1);

    try {
      const res = await apiFetch('/api/academy/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          missionId: mission.id,
          type: 'run',
          detail: {
            program: code,
            hintsUsed: hintsRevealed,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        serverEvalRef.current = data;
        setServerResult(data);
        setIsPlaying(true);
      } else {
        console.warn('[Academy] Run event returned error status:', res.status);
        setIsPlaying(true);
      }
    } catch (err) {
      console.warn('[Academy] Failed to evaluate run:', err);
      setIsPlaying(true);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Simulation playback loop
  useEffect(() => {
    if (!isPlaying || collision || isPassed) return;

    const interval = setInterval(() => {
      setPlaybackIndex((prev) => {
        const next = prev + 1;
        const totalSegments = parseResult.segments.length;

        if (next >= totalSegments) {
          setIsPlaying(false);
          if (serverEvalRef.current?.passed) {
            setIsPassed(true);
          } else if (!serverEvalRef.current && !parseResult.findings.some((f) => f.severity === 'CRITICAL')) {
            setIsPassed(true);
          }
          return prev;
        }

        const segment = parseResult.segments[next];

        // Check if server indicated a crash at this line
        const serverCrash = serverEvalRef.current?.crashEvent;
        if (serverCrash && segment.line >= serverCrash.line) {
          setCollision(serverCrash);
          setIsPlaying(false);
          playCrashSound();
          triggerShake();
          return next;
        }

        return next;
      });
    }, 100 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, collision, isPassed, parseResult.segments, playbackSpeed]);

  const handleReset = () => {
    setPlaybackIndex(-1);
    setIsPlaying(false);
    setCollision(null);
    setIsPassed(false);
    serverEvalRef.current = null;
  };

  const handleNextMission = () => {
    if (!mission) {
      onBack();
      return;
    }
    const currentIdx = ACADEMY_MISSIONS.findIndex((m) => m.id === mission.id);
    if (currentIdx >= 0 && currentIdx + 1 < ACADEMY_MISSIONS.length) {
      const next = ACADEMY_MISSIONS[currentIdx + 1];
      onNavigate('academy', { missionId: next.id });
    } else {
      onBack();
    }
  };

  const currentSegment = parseResult.segments[playbackIndex] || { to: { x: 0, y: 0, z: 50 }, line: 0 };
  const currentModal = modalTracker(currentSegment.line);

  if (!mission) {
    return (
      <EmptyState
        icon="error"
        title="Mission Not Found"
        description="The requested training scenario does not exist."
      />
    );
  }

  return (
    <div className="max-w-[1720px] mx-auto p-space-md lg:p-margin flex flex-col gap-space-md">
      <PageHeader
        label={`MISSION 0${ACADEMY_MISSIONS.indexOf(mission) + 1}`}
        title={mission.name}
        caption="Training VMC (simulated)"
        icon="school"
        actions={
          <ButtonSecondary onClick={onBack} icon="arrow_back">
            Back to Map
          </ButtonSecondary>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
        {/* LEFT COLUMN: Brief & Editor */}
        <div className="lg:col-span-3 flex flex-col gap-space-md h-full">
          <Card className="p-4 bg-surface-container-low border-outline-variant/40">
            <SectionHeader title="Scenario Brief" icon="assignment" className="border-0 mb-2" />
            <p className="text-xs text-tertiary leading-relaxed mb-3">{mission.description}</p>
            <div className="pt-3 border-t border-outline-variant/30 flex justify-between items-center text-[10px] font-mono">
              <span className="text-tertiary-container uppercase">Target Reward:</span>
              <span className="text-secondary font-bold">+{mission.targetXP} XP</span>
            </div>
          </Card>

          <div className="flex-1 min-h-[400px]">
            <CodeEditor
              code={code}
              onChange={(newCode) => {
                setCode(newCode);
                handleReset();
                apiFetch('/api/academy/event', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: sessionIdRef.current,
                    missionId: mission.id,
                    type: 'edit',
                    detail: { length: newCode.length },
                  }),
                }).catch(() => {});
              }}
              flaggedLines={collision ? [collision.line] : []}
              selectedLine={currentSegment.line}
              language="gcode"
            />
          </div>
        </div>

        {/* CENTER COLUMN: 3D Scene & Controls */}
        <div className="lg:col-span-5 flex flex-col gap-space-md">
          {/* Status Bar */}
          <div
            className={`px-4 py-2.5 rounded-xl border flex items-center justify-between transition-all ${
              collision
                ? 'bg-error-container/20 border-error/50 animate-pulse'
                : isPassed
                ? 'bg-secondary/10 border-secondary/50'
                : 'bg-surface-container-low border-outline-variant/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  collision
                    ? 'bg-error animate-ping'
                    : isPassed
                    ? 'bg-secondary'
                    : isPlaying
                    ? 'bg-primary-container animate-pulse'
                    : 'bg-tertiary-container'
                }`}
              ></span>
              <span className="text-xs font-mono font-bold uppercase tracking-wider">
                {collision
                  ? collision.description
                  : isPassed
                  ? 'MISSION PASSED: SAFE RUN'
                  : isPlaying
                  ? 'SIMULATION ACTIVE'
                  : 'SYSTEM STANDBY'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono text-tertiary">
              <span>
                LINE: <strong className="text-on-surface">{currentSegment.line}</strong>
              </span>
              <span>
                SPINDLE:{' '}
                <strong className={currentModal.spindleOn ? 'text-secondary' : 'text-error'}>
                  {currentModal.spindleOn ? 'ON' : 'OFF'}
                </strong>
              </span>
            </div>
          </div>

          <div
            className={`relative rounded-xl overflow-hidden h-[650px] transition-transform duration-75 ${
              cameraShake ? 'translate-x-1' : ''
            }`}
          >
            <Viewport3D
              cameraPosition={[120, 100, 120]}
              showGrid={false}
              className="bg-zinc-200"
              overlay={
                <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-3 pointer-events-none">
                  {/* Damage Assessment Card */}
                  {collision && (
                    <Card className="p-4 bg-error-container/10 border-error/40 backdrop-blur-md shadow-2xl animate-slide-in-right pointer-events-auto">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded bg-error/20 flex items-center justify-center text-error border border-error/40">
                          <span className="material-symbols-outlined">fmd_bad</span>
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-error text-sm uppercase">Damage Assessment</h4>
                          <div className="grid grid-cols-2 gap-4 mt-2">
                            <div>
                              <span className="text-[9px] text-tertiary block uppercase">Part Damaged</span>
                              <span className="text-xs font-bold text-on-surface">{collision.part}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-tertiary block uppercase">Repair Cost</span>
                              <span className="text-xs font-bold text-error font-mono">
                                ₹{collision.cost.toLocaleString()} INR
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] text-tertiary block uppercase">Downtime</span>
                              <span className="text-xs font-bold text-primary-container font-mono">
                                {collision.downtime} Days
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] text-tertiary block uppercase">Root Cause</span>
                              <span className="text-[10px] text-tertiary leading-tight">{collision.rootCause}</span>
                            </div>
                          </div>
                          <div className="mt-3 pt-2 border-t border-outline-variant/20 text-[9px] text-tertiary-container italic">
                            Illustrative training cost. Real costs vary by machine.
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Completion Card */}
                  {isPassed && (
                    <Card className="p-6 bg-secondary/10 border-secondary/40 backdrop-blur-md shadow-2xl animate-slide-in-right pointer-events-auto flex flex-col items-center text-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center text-secondary border-4 border-secondary shadow-[0_0_30px_theme(colors.secondary/0.3)]">
                        <span className="material-symbols-outlined text-[40px]">military_tech</span>
                      </div>
                      <div>
                        <h4 className="text-headline-md font-bold text-on-surface">Mission Accomplished!</h4>
                        <p className="text-sm text-tertiary">Zero kinematic violations detected in updated toolpath.</p>
                      </div>
                      <div className="flex gap-4 items-center">
                        <div className="px-4 py-2 rounded-xl bg-surface-container border border-outline-variant/40">
                          <span className="text-[10px] text-tertiary block uppercase">XP Awarded</span>
                          <span className="text-xl font-bold text-primary-container">
                            +{serverResult?.xpEarned ?? calculateMissionXP(mission.targetXP, hintsRevealed)} XP
                          </span>
                        </div>
                        {mission.badgeId && (
                          <div className="px-4 py-2 rounded-xl bg-surface-container border border-outline-variant/40">
                            <span className="text-[10px] text-tertiary block uppercase">Badge Earned</span>
                            <span className="text-xs font-bold text-secondary uppercase tracking-widest">
                              {mission.badgeId.replace('-', ' ')}
                            </span>
                          </div>
                        )}
                      </div>
                      <ButtonPrimary onClick={handleNextMission} icon="navigate_next" className="w-full mt-2">
                        Next Mission
                      </ButtonPrimary>
                    </Card>
                  )}

                  {/* Coordinates Overlay */}
                  <div className="flex justify-between items-end">
                    <div className="px-3 py-1.5 rounded-lg bg-surface-container-low/80 backdrop-blur border border-outline-variant/30 text-[10px] font-mono flex flex-col gap-0.5">
                      <div className="flex gap-2">
                        <span className="text-tertiary">X:</span>
                        <span className="text-on-surface font-bold">{currentSegment.to.x.toFixed(3)}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-tertiary">Y:</span>
                        <span className="text-on-surface font-bold">{currentSegment.to.y.toFixed(3)}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-tertiary">Z:</span>
                        <span
                          className={
                            collision && collision.type === 'VISE_CRASH'
                              ? 'text-error font-bold'
                              : 'text-secondary font-bold'
                          }
                        >
                          {currentSegment.to.z.toFixed(3)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              }
            >
              <MachineScene
                toolPosition={currentSegment.to}
                spindleOn={currentModal.spindleOn}
                isCrashing={!!collision}
                crashObject={
                  collision?.type === 'STOCK_CRASH' ? 'STOCK' : collision?.type === 'VISE_CRASH' ? 'VISE' : null
                }
              />
            </Viewport3D>
          </div>

          {/* Simulation Controls */}
          <Card className="p-4 bg-surface-container-low border-outline-variant/40 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {collision ? (
                <ButtonDanger
                  onClick={() => {
                    handleReset();
                    handleRunSimulation();
                  }}
                  icon="replay"
                  className="h-12 px-6"
                >
                  Rewind and fix
                </ButtonDanger>
              ) : (
                <ButtonPrimary
                  onClick={() => {
                    if (isPlaying) {
                      setIsPlaying(false);
                    } else {
                      handleRunSimulation();
                    }
                  }}
                  icon={isPlaying ? 'pause' : 'play_arrow'}
                  className="h-12 px-6"
                  disabled={isPassed || isEvaluating}
                >
                  {isEvaluating
                    ? 'Evaluating...'
                    : isPlaying
                    ? 'Pause Simulation'
                    : 'Run Simulation'}
                </ButtonPrimary>
              )}
              <ButtonSecondary onClick={handleReset} icon="history" className="h-12">
                Reset
              </ButtonSecondary>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono font-bold text-tertiary uppercase">Speed:</span>
              <Tabs
                activeTab={playbackSpeed.toString()}
                onTabChange={(id) => setPlaybackSpeed(parseFloat(id))}
                tabs={[
                  { id: '0.5', label: '0.5x' },
                  { id: '1', label: '1x' },
                  { id: '2', label: '2x' },
                ]}
              />
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: Instructor */}
        <div className="lg:col-span-4 h-full">
          <InstructorPanel
            missionId={missionId}
            sessionId={sessionIdRef.current}
            hintsRevealed={hintsRevealed}
            onRevealHint={() => setHintsRevealed((prev) => Math.min(3, prev + 1))}
            xpPenalty={20}
            program={code}
            crashEvent={collision}
          />
        </div>
      </div>
    </div>
  );
}
