import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { db, apiFetch } from '../../lib/firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';
import { PageHeader, SectionHeader, StatChip } from '../ui/Headers.js';
import { Card } from '../ui/Layout.js';
import { Badge } from '../ui/Badge.js';
import { ProgressBar, Skeleton } from '../ui/Feedback.js';
import { ACADEMY_MISSIONS } from '../../engine/crash.js';

interface AcademyProgress {
  xp: number;
  level: string;
  streakDays: number;
  badges: string[];
  completedMissions: string[];
}

interface AcademyStats {
  learners: number;
  completions: number;
  avgCrashes: number;
  mostCommonCrash: string;
}

export function MissionMap({ onNavigate }: { onNavigate: (tab: string, state?: any) => void }) {
  const { user, isAdmin } = useAuth();
  const [progress, setProgress] = useState<AcademyProgress>({
    xp: 0,
    level: 'Trainee',
    streakDays: 0,
    badges: [],
    completedMissions: [],
  });
  const [stats, setStats] = useState<AcademyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    // Listen to user progress
    const unsub = onSnapshot(doc(db, 'users', user.uid, 'academy', 'progress'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setProgress({
          xp: data.xp || 0,
          level: data.level || 'Trainee',
          streakDays: data.streakDays || 0,
          badges: data.badges || [],
          completedMissions: data.completedMissions || [],
        });
      }
      setLoading(false);
    });

    // Fetch admin stats if applicable
    if (isAdmin) {
      apiFetch('/api/academy/stats')
        .then(res => res.json())
        .then(data => setStats(data))
        .catch(err => console.warn('[Academy] Failed to fetch stats:', err));
    }

    return () => unsub();
  }, [user, isAdmin]);

  const xpNext = progress.xp < 200 ? 200 : progress.xp < 400 ? 400 : 1000; // Placeholder for next level
  const xpPercent = (progress.xp / xpNext) * 100;
  
  const getLevelName = (xp: number) => {
    if (xp >= 400) return 'Setter';
    if (xp >= 200) return 'Operator';
    return 'Trainee';
  };

  const currentLevel = getLevelName(progress.xp);

  const badgeShelf = [
    { id: 'offset-master', label: 'Offset Master', icon: 'straighten' },
    { id: 'safe-approach', label: 'Safe Approach', icon: 'gpp_good' },
    { id: 'tap-whisperer', label: 'Tap Whisperer', icon: 'build' },
    { id: 'safe-starter', label: 'Safe Starter', icon: 'verified' },
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
                <span className="font-mono text-[10px] text-tertiary uppercase">{progress.xp} / {xpNext} XP</span>
              </div>
              <ProgressBar progress={xpPercent} variant="primary" />
            </div>
            <StatChip label="Streak" value={`${progress.streakDays} Days`} icon="local_fire_department" variant="secondary" />
            
            <div className="flex items-center gap-1.5 pl-space-md border-l border-outline-variant/30">
              {badgeShelf.map(b => (
                <div 
                  key={b.id} 
                  title={b.label}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-all ${
                    progress.badges.includes(b.id) 
                      ? 'bg-secondary/10 border-secondary text-secondary shadow-[0_0_12px_theme(colors.secondary/0.2)]' 
                      : 'bg-surface-container-low border-outline-variant/20 text-tertiary/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{b.icon}</span>
                </div>
              ))}
            </div>
          </div>
        }
      />

      {isAdmin && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
          <Card className="p-space-md">
            <SectionHeader title="Active Learners" icon="groups" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-on-surface">{stats.learners}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Completions" icon="task_alt" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-secondary">{stats.completions}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Avg Crashes/Pass" icon="warning" className="border-0 mb-1" />
            <div className="text-headline-lg font-bold text-primary-container">{stats.avgCrashes.toFixed(1)}</div>
          </Card>
          <Card className="p-space-md">
            <SectionHeader title="Common Crash" icon="error" className="border-0 mb-1" />
            <div className="text-body-md font-bold text-error truncate">{stats.mostCommonCrash}</div>
          </Card>
        </div>
      )}

      <div className="flex flex-col gap-space-md max-w-4xl mx-auto w-full py-8">
        <SectionHeader title="Industrial Certification Path" icon="route" />
        
        <div className="relative space-y-6">
          {/* Vertical line connector */}
          <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-outline-variant/30" />
          
          {ACADEMY_MISSIONS.map((mission, idx) => {
            const isCompleted = progress.completedMissions.includes(mission.id);
            const isLocked = !isCompleted && progress.xp < mission.levelReq;
            // A mission is current if it's the first non-completed mission we encounter
            const isCurrent = !isCompleted && !isLocked;
            
            return (
              <div key={mission.id} className="relative pl-14">
                <div 
                  className={`absolute left-0 top-6 w-12 h-12 rounded-full border-4 border-surface-container flex items-center justify-center z-10 transition-all ${
                    isCompleted ? 'bg-secondary text-on-secondary' : 
                    isCurrent ? 'bg-primary-container text-on-primary-container animate-pulse shadow-[0_0_15px_theme(colors.primary-container/0.5)]' : 
                    'bg-surface-container-high text-tertiary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[24px]">
                    {isCompleted ? 'check' : isLocked ? 'lock' : 'play_arrow'}
                  </span>
                </div>

                <Card 
                  accent={isCompleted ? 'green' : isCurrent ? 'orange' : undefined}
                  className={`p-space-lg cursor-pointer transition-all ${isLocked ? 'opacity-50 grayscale pointer-events-none' : 'hover:scale-[1.01] hover:shadow-xl'}`}
                  onClick={() => !isLocked && onNavigate('academy', { missionId: mission.id })}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] uppercase text-tertiary tracking-widest mb-1">Mission 0{idx + 1}</span>
                      <h3 className="text-headline-md font-bold text-on-surface">{mission.name}</h3>
                    </div>
                    <div className="flex flex-col items-end">
                      <Badge variant={isCompleted ? 'success' : isCurrent ? 'warning' : 'tertiary'}>
                        {isCompleted ? 'PASSED' : isLocked ? 'LOCKED' : 'ACTIVE'}
                      </Badge>
                      <span className="font-mono text-[11px] text-tertiary mt-1">+{mission.targetXP} XP</span>
                    </div>
                  </div>
                  <p className="text-body-md text-tertiary leading-relaxed max-w-2xl">
                    {mission.description}
                  </p>
                  {isCurrent && (
                    <div className="mt-4 flex items-center gap-2 text-primary-container font-bold text-xs uppercase tracking-wider">
                      <span>Begin Diagnostic Session</span>
                      <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
