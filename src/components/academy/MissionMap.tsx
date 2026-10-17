import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { db, apiFetch } from '../../lib/firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';
import { PageHeader, SectionHeader, StatChip } from '../ui/Headers.js';
import { Card } from '../ui/Layout.js';
import { Badge } from '../ui/Badge.js';
import { ProgressBar, Drawer } from '../ui/Feedback.js';
import { ButtonSecondary } from '../ui/Button.js';
import { ACADEMY_MISSIONS, calculateLevel } from '../../engine/crash.js';

interface TraineeMissionState {
  status: 'locked' | 'current' | 'passed';
  attempts: number;
  crashes: number;
  hintsUsed: number;
  bestXp: number;
  firstPassAt: string | null;
  objectivesMet: string[];
}

interface TraineeData {
  displayName?: string;
  photoURL?: string | null;
  enrolledAt?: string;
  lastActiveAt?: string;
  xp?: number;
  level?: string;
  streakDays?: number;
  lastStreakDate?: string;
  badges?: string[];
  missions?: Record<string, TraineeMissionState>;
  totalSimRuns?: number;
}

interface AcademyStats {
  learners: number;
  activeLast7Days: number;
  completions: number;
  totalRuns: number;
  totalCrashes: number;
  avgCrashesBeforePass: number;
  mostCommonCrash: string | null;
}

interface AdminTrainee {
  uid: string;
  name: string;
  email: string;
  level: string;
  xp: number;
  missionsPassed: number;
  crashes: number;
  lastActive: string | null;
}

export function MissionMap({ onNavigate }: { onNavigate: (tab: string, state?: any) => void }) {
  const { user, isAdmin } = useAuth();
  const [trainee, setTrainee] = useState<TraineeData | null>(null);
  const [stats, setStats] = useState<AcademyStats | null>(null);
  const [isBadgesOpen, setIsBadgesOpen] = useState(false);
  const [isTraineesOpen, setIsTraineesOpen] = useState(false);
  const [adminTrainees, setAdminTrainees] = useState<AdminTrainee[]>([]);
  const [loadingTrainees, setLoadingTrainees] = useState(false);

  useEffect(() => {
    if (!user) return;

    // 1. Call enrollment endpoint
    apiFetch('/api/academy/enroll', { method: 'POST' }).catch((err) => {
      console.warn('[Academy] Enrollment request warning:', err);
    });

    // 2. Real-time subscription to trainees/{uid}
    const unsubTrainee = onSnapshot(doc(db, 'trainees', user.uid), (snap) => {
      if (snap.exists()) {
        setTrainee(snap.data() as TraineeData);
      }
    });

    // 3. Real-time subscription to academy_stats/global
    const unsubStats = onSnapshot(doc(db, 'academy_stats', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const crashCounts = data.crashCounts || {};
        let mostCommonCrash = 'None';
        let maxCount = 0;
        for (const [type, count] of Object.entries(crashCounts)) {
          if (typeof count === 'number' && count > maxCount) {
            maxCount = count;
            mostCommonCrash = type;
          }
        }
        setStats({
          learners: data.learners || 0,
          activeLast7Days: data.activeLast7Days || 0,
          completions: data.completions || 0,
          totalRuns: data.totalRuns || 0,
          totalCrashes: data.totalCrashes || 0,
          avgCrashesBeforePass: typeof data.avgCrashesBeforePass === 'number' ? data.avgCrashesBeforePass : 0,
          mostCommonCrash,
        });
      }
    });

    return () => {
      unsubTrainee();
      unsubStats();
    };
  }, [user]);

  const handleOpenTrainees = async () => {
    setIsTraineesOpen(true);
    setLoadingTrainees(true);
    try {
      const res = await apiFetch('/api/academy/trainees');
      if (res.ok) {
        const data = await res.json();
        setAdminTrainees(data.trainees || []);
      }
    } catch (err) {
      console.warn('[Academy] Failed to fetch trainees roster:', err);
    } finally {
      setLoadingTrainees(false);
    }
  };

  const xp = trainee?.xp || 0;
  const currentLevel = calculateLevel(xp);
  const xpNext = xp < 200 ? 200 : xp < 400 ? 400 : 1000;
  const xpPercent = Math.min(100, (xp / xpNext) * 100);
  const streakDays = trainee?.streakDays || 0;
  const earnedBadges = trainee?.badges || [];

  const badgeShelf = [
    {
      id: 'offset-master',
      label: 'Offset Master',
      icon: 'straighten',
      description: 'Activate tool length compensation (G43 H01) correctly after tool change.',
    },
    {
      id: 'safe-approach',
      label: 'Safe Approach',
      icon: 'gpp_good',
      description: 'Avoid rapid traverse into stock; control approach with feed motion.',
    },
    {
      id: 'tap-whisperer',
      label: 'Tap Whisperer',
      icon: 'build',
      description: 'Synchronize rigid tapping feed and spindle speed for pitch M10x1.5.',
    },
    {
      id: 'safe-starter',
      label: 'Safe Starter',
      icon: 'verified',
      description: 'Ensure spindle rotation (M03) is active before first cut enters workpiece.',
    },
  ];

  return (
    <div className="max-w-[1720px] mx-auto p-space-md lg:p-margin flex flex-col gap-space-lg">
      <PageHeader
        label="ACADEMY"
        title="Crash Lab"
        caption="Crash the machine here. Never on the shop floor."
        icon="school"
        actions={
          <div className="flex flex-wrap items-center gap-space-md">
            <div className="flex flex-col gap-1 min-w-[200px]">
              <div className="flex justify-between items-center mb-1">
                <Badge variant={currentLevel === 'Setter' ? 'primary' : currentLevel === 'Operator' ? 'secondary' : 'tertiary'}>
                  {currentLevel}
                </Badge>
                <span className="font-mono text-[10px] text-tertiary uppercase">{xp} / {xpNext} XP</span>
              </div>
              <ProgressBar progress={xpPercent} variant="primary" />
            </div>
            <StatChip label="Streak" value={`${streakDays} Days`} icon="local_fire_department" variant="secondary" />
            
            {/* Badge Shelf with tooltip and drawer click */}
            <div className="flex items-center gap-1.5 pl-space-md border-l border-outline-variant/30">
              {badgeShelf.map((b) => {
                const isEarned = earnedBadges.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    title={b.label}
                    aria-label={b.label}
                    onClick={() => setIsBadgesOpen(true)}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                      isEarned
                        ? 'bg-secondary/10 border-secondary text-secondary shadow-[0_0_12px_theme(colors.secondary/0.2)]'
                        : 'bg-surface-container-low border-outline-variant/20 text-tertiary/30 hover:border-outline-variant/50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{b.icon}</span>
                  </button>
                );
              })}
            </div>
          </div>
        }
      />

      {/* Global Stats Row - visible to all signed-in users */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md items-center">
          <Card className="p-space-md">
            <SectionHeader title="Learners" icon="groups" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-on-surface">{stats?.learners ?? 0}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Active (7 days)" icon="calendar_today" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-on-surface">{stats?.activeLast7Days ?? 0}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Completions" icon="task_alt" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-secondary">{stats?.completions ?? 0}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Avg crashes before pass" icon="warning" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-primary-container">{(stats?.avgCrashesBeforePass ?? 0).toFixed(1)}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Most common crash" icon="error" className="border-0 mb-1" />
            <div className="text-body-md font-bold text-error truncate">{stats?.mostCommonCrash || 'None'}</div>
          </Card>
        </div>

        {/* Admin Roster Action */}
        {isAdmin && (
          <div className="flex justify-end pt-1">
            <ButtonSecondary onClick={handleOpenTrainees} icon="people">
              View trainees
            </ButtonSecondary>
          </div>
        )}
      </div>

      {/* Training Path */}
      <div className="flex flex-col gap-space-md max-w-4xl mx-auto w-full py-8">
        <SectionHeader title="TRAINING PATH" icon="route" />
        
        <div className="relative space-y-6">
          {/* Vertical line connector */}
          <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-outline-variant/30" />
          
          {ACADEMY_MISSIONS.map((mission, idx) => {
            const missionState = trainee?.missions?.[mission.id];
            const isPassed = missionState?.status === 'passed';
            const isCurrent = missionState?.status === 'current';
            const isLocked = !missionState || missionState.status === 'locked';
            
            return (
              <div key={mission.id} className="relative pl-14">
                <div 
                  className={`absolute left-0 top-6 w-12 h-12 rounded-full border-4 border-surface-container flex items-center justify-center z-10 transition-all ${
                    isPassed ? 'bg-secondary text-on-secondary' : 
                    isCurrent ? 'bg-primary-container text-on-primary-container animate-pulse shadow-[0_0_15px_theme(colors.primary-container/0.5)]' : 
                    'bg-surface-container-high text-tertiary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[24px]">
                    {isPassed ? 'check' : isLocked ? 'lock' : 'play_arrow'}
                  </span>
                </div>

                <Card 
                  accent={isPassed ? 'green' : isCurrent ? 'orange' : undefined}
                  className={`p-space-lg cursor-pointer transition-all ${isLocked ? 'opacity-50 grayscale pointer-events-none' : 'hover:scale-[1.01] hover:shadow-xl'}`}
                  onClick={() => !isLocked && onNavigate('academy', { missionId: mission.id })}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] uppercase text-tertiary tracking-widest mb-1">Mission 0{idx + 1}</span>
                      <h3 className="text-headline-md font-bold text-on-surface">{mission.name}</h3>
                    </div>
                    <div className="flex flex-col items-end">
                      <Badge variant={isPassed ? 'success' : isCurrent ? 'warning' : 'tertiary'}>
                        {isPassed ? 'PASSED' : isLocked ? 'LOCKED' : 'CURRENT'}
                      </Badge>
                      <span className="font-mono text-[11px] text-tertiary mt-1">+{mission.targetXP} XP</span>
                    </div>
                  </div>
                  <p className="text-body-md text-tertiary leading-relaxed max-w-2xl">
                    {mission.description}
                  </p>
                  {isCurrent && (
                    <div className="mt-4 flex items-center gap-2 text-primary-container font-bold text-xs uppercase tracking-wider">
                      <span>START MISSION</span>
                      <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </div>
                  )}
                  {isPassed && (
                    <div className="mt-4 flex items-center gap-2 text-secondary font-bold text-xs uppercase tracking-wider">
                      <span>REPLAY MISSION</span>
                      <span className="material-symbols-outlined text-[16px]">replay</span>
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      {/* Badges Drawer */}
      <Drawer
        isOpen={isBadgesOpen}
        onClose={() => setIsBadgesOpen(false)}
        title="Academy Badges Shelf"
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-tertiary leading-relaxed">
            Earn industrial certification badges by eliminating kinematic crash conditions with zero safety violations.
          </p>
          <div className="space-y-3">
            {badgeShelf.map((b) => {
              const isEarned = earnedBadges.includes(b.id);
              const relatedMission = ACADEMY_MISSIONS.find((m) => m.badgeId === b.id);
              const missionState = relatedMission ? trainee?.missions?.[relatedMission.id] : null;

              return (
                <div
                  key={b.id}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition-colors ${
                    isEarned
                      ? 'bg-secondary/10 border-secondary/40 text-on-surface'
                      : 'bg-surface-container-low border-outline-variant/30 text-tertiary opacity-75'
                  }`}
                >
                  <div
                    className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                      isEarned
                        ? 'bg-secondary/20 border-secondary text-secondary'
                        : 'bg-surface-container border-outline-variant/20 text-tertiary/40'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[24px]">{b.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-sm text-on-surface truncate">{b.label}</h4>
                      <Badge variant={isEarned ? 'success' : 'tertiary'}>
                        {isEarned ? 'EARNED' : 'LOCKED'}
                      </Badge>
                    </div>
                    <p className="text-xs text-tertiary mt-1 leading-relaxed">{b.description}</p>
                    {isEarned && missionState?.firstPassAt && (
                      <span className="font-mono text-[10px] text-secondary mt-1.5 block">
                        Earned: {new Date(missionState.firstPassAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Drawer>

      {/* Admin Trainees Roster Drawer */}
      <Drawer
        isOpen={isTraineesOpen}
        onClose={() => setIsTraineesOpen(false)}
        title="Academy Trainees Roster"
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-tertiary leading-relaxed">
            Real-time trainee performance metrics, sorted by latest activity.
          </p>
          {loadingTrainees ? (
            <div className="p-8 text-center text-xs font-mono text-tertiary">Loading trainees...</div>
          ) : adminTrainees.length === 0 ? (
            <div className="p-8 text-center text-xs text-tertiary">No trainees registered yet.</div>
          ) : (
            <div className="space-y-3">
              {adminTrainees.map((t) => (
                <div
                  key={t.uid}
                  className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-on-surface">{t.name}</h4>
                      <span className="font-mono text-[10px] text-tertiary">{t.email || t.uid.slice(0, 8)}</span>
                    </div>
                    <Badge variant={t.level === 'Setter' ? 'primary' : t.level === 'Operator' ? 'secondary' : 'tertiary'}>
                      {t.level}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-outline-variant/20 text-[11px] font-mono">
                    <div>
                      <span className="text-[9px] text-tertiary uppercase block">XP</span>
                      <strong className="text-primary-container">{t.xp}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-tertiary uppercase block">Passed</span>
                      <strong className="text-secondary">{t.missionsPassed} / 4</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-tertiary uppercase block">Crashes</span>
                      <strong className={t.crashes > 0 ? 'text-error' : 'text-on-surface'}>{t.crashes}</strong>
                    </div>
                  </div>
                  {t.lastActive && (
                    <span className="text-[10px] font-mono text-tertiary-container block">
                      Last Active: {new Date(t.lastActive).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
