import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
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

interface DashboardProps {
  onNavigate: (tab: string, state?: any) => void;
}

export interface ActivityItem {
  id: string;
  type: 'chat' | 'calc' | 'gcode' | 'academy';
  title: string;
  summary?: string;
  link?: string;
  alarm?: string;
  controller?: string;
  imageUrl?: string;
  createdAt?: string;
}

interface ManualItem {
  id: string;
  name: string;
  controller: string;
  docType: string;
  pages?: number;
  status: string;
}

interface AcademyProgress {
  xp: number;
  level: string;
  streakDays: number;
  missions?: Record<string, any>;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { user, profile, isAdmin } = useAuth();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [manuals, setManuals] = useState<ManualItem[]>([]);
  const [academy, setAcademy] = useState<AcademyProgress | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<{ url: string; caption?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'calc' | 'alarm' | 'gcode'>('all');

  // Time & shift computation
  const now = new Date();
  const hour = now.getHours();

  let greeting = 'Good morning';
  if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
  if (hour >= 17 || hour < 4) greeting = 'Good evening';

  let shiftName = 'Shift 1 (06:00-14:00)';
  if (hour >= 14 && hour < 22) shiftName = 'Shift 2 (14:00-22:00)';
  if (hour >= 22 || hour < 6) shiftName = 'Shift 3 (22:00-06:00)';

  const dateFormatted = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const firstName = (profile?.displayName || user?.displayName || 'Operator').split(' ')[0];
  const preferredControllerName = (profile?.preferredController || 'fanuc').toUpperCase();

  // Real-time Firestore subscriptions
  useEffect(() => {
    if (!user) return;

    // 1. Subscribe to recent activities (up to 20 for metrics & filtering)
    const activityQuery = query(
      collection(db, 'users', user.uid, 'activity'),
      orderBy('createdAt', 'desc'),
      limit(25)
    );

    const unsubActivity = onSnapshot(
      activityQuery,
      (snap) => {
        const list: ActivityItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setActivities(list);

        // Find last image snapshot from activities if available
        const imgActivity = list.find((a) => a.imageUrl);
        if (imgActivity && imgActivity.imageUrl) {
          setLastSnapshot({ url: imgActivity.imageUrl, caption: imgActivity.summary || imgActivity.title });
        }
      },
      (err) => console.warn('[Dashboard] Activity stream notice:', err)
    );

    // 2. Fetch last screen snapshot from recent messages across chats if not found in activity
    const fetchLatestMessageSnapshot = async () => {
      try {
        if (!user?.uid) return;
        const chatsSnap = await getDocs(
          query(collection(db, 'users', user.uid, 'chats'), orderBy('updatedAt', 'desc'), limit(3))
        );
        if (!chatsSnap || chatsSnap.empty || !chatsSnap.docs) return;

        for (const chatDoc of chatsSnap.docs) {
          if (!chatDoc?.id) continue;
          try {
            const msgsSnap = await getDocs(
              query(collection(db, 'users', user.uid, 'chats', chatDoc.id, 'messages'), orderBy('createdAt', 'desc'), limit(5))
            );
            if (!msgsSnap || msgsSnap.empty || !msgsSnap.docs) continue;

            const msgWithImg = msgsSnap.docs.find((m) => {
              const d = m?.data?.();
              return Boolean(d && d.imageUrl);
            });

            if (msgWithImg) {
              const data = msgWithImg.data();
              if (data?.imageUrl) {
                setLastSnapshot({
                  url: data.imageUrl,
                  caption: data.text ? String(data.text).slice(0, 80) : 'Pendant Alarm Screen',
                });
                break;
              }
            }
          } catch {
            // Ignore single chat message read faults gracefully
          }
        }
      } catch {
        // Handled silently
      }
    };
    fetchLatestMessageSnapshot();

    // 3. Subscribe to Ready OEM manuals
    const manualsQuery = query(
      collection(db, 'kb_docs'),
      where('status', '==', 'Ready'),
      limit(8)
    );

    const unsubManuals = onSnapshot(
      manualsQuery,
      (snap) => {
        const list: ManualItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setManuals(list);
      },
      (err) => console.warn('[Dashboard] Manuals stream notice:', err)
    );

    // 4. Subscribe to Academy Progress
    const unsubAcademy = onSnapshot(
      doc(db, 'users', user.uid, 'academy', 'progress'),
      (snap) => {
        if (snap.exists()) {
          setAcademy(snap.data() as AcademyProgress);
        }
      },
      (err) => console.warn('[Dashboard] Academy progress stream notice:', err)
    );

    return () => {
      unsubActivity();
      unsubManuals();
      unsubAcademy();
    };
  }, [user]);

  // Rule 1: Alert banner: show only when the user's latest activity of type "chat" in the last 24 h has an alarm code
  const latestChatWithAlarm = useMemo(() => {
    const chatActivities = (activities || []).filter((a) => a && a.type === 'chat');
    if (!chatActivities.length) return null;
    const latest = chatActivities[0];
    if (!latest || !latest.createdAt) return null;

    const diffHours = (now.getTime() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
    if (diffHours > 24) return null;

    // Check if alarm code exists in alarm field or title
    const titleStr = typeof latest.title === 'string' ? latest.title : '';
    const alarmCode = latest.alarm || (titleStr.match(/SV\d+|ALARM\s*\w+|\b[A-Z]{2,}\d{3,}\b/i)?.[0]);
    if (!alarmCode) return null;

    return {
      ...latest,
      detectedAlarm: alarmCode,
    };
  }, [activities]);

  // Rule 3: The 4 stat chips for today
  const todayDateStr = now.toISOString().slice(0, 10);
  const questionsToday = (activities || []).filter((a) => a && a.type === 'chat' && a.createdAt?.startsWith(todayDateStr)).length;
  const calcsToday = (activities || []).filter((a) => a && a.type === 'calc' && a.createdAt?.startsWith(todayDateStr)).length;
  const verifiedToday = (activities || []).filter((a) => a && a.type === 'gcode' && a.createdAt?.startsWith(todayDateStr)).length;

  // Rule 5: Activity counts for last 7 days SVG area chart & 4 readouts
  const { chartData, totalChats, totalCalcs, totalVerified, crashesAvoided } = useMemo(() => {
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().slice(0, 10);
      days.push({ date: dStr, count: 0 });
    }

    let chats = 0;
    let calcs = 0;
    let verified = 0;

    activities.forEach((act) => {
      if (act.type === 'chat') chats++;
      if (act.type === 'calc') calcs++;
      if (act.type === 'gcode') verified++;

      if (act.createdAt) {
        const dStr = act.createdAt.slice(0, 10);
        const dayEntry = days.find((d) => d.date === dStr);
        if (dayEntry) dayEntry.count++;
      }
    });

    let passedMissions = 0;
    if (academy?.missions) {
      Object.values(academy.missions).forEach((m: any) => {
        if (m?.status === 'completed' || m?.bestXp > 0) passedMissions++;
      });
    }

    return {
      chartData: days,
      totalChats: chats,
      totalCalcs: calcs,
      totalVerified: verified,
      crashesAvoided: passedMissions,
    };
  }, [activities, academy]);

  // SVG Area path generation for last 7 days
  const { svgAreaPath, svgLinePath, maxVal, currentDayVal } = useMemo(() => {
    const counts = chartData.map((d) => d.count);
    const max = Math.max(...counts, 4); // baseline max 4 for scale
    const width = 700;
    const height = 140;

    const points = chartData.map((d, index) => {
      const x = (index / (chartData.length - 1)) * width;
      const y = height - (d.count / max) * (height - 30) - 20;
      return { x, y };
    });

    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cx = (prev.x + curr.x) / 2;
      linePath += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

    return {
      svgAreaPath: areaPath,
      svgLinePath: linePath,
      maxVal: Math.max(...counts),
      currentDayVal: counts[counts.length - 1] || 0,
    };
  }, [chartData]);

  // Rule 7: Filter activities by active tab
  const filteredActivities = useMemo(() => {
    if (activeTab === 'all') return activities.slice(0, 8);
    if (activeTab === 'calc') return activities.filter((a) => a.type === 'calc').slice(0, 8);
    if (activeTab === 'alarm') return activities.filter((a) => a.type === 'chat').slice(0, 8);
    if (activeTab === 'gcode') return activities.filter((a) => a.type === 'gcode').slice(0, 8);
    return activities.slice(0, 8);
  }, [activities, activeTab]);

  // Helper for relative timestamps
  const getRelativeTime = (iso?: string) => {
    if (!iso) return 'Just now';
    const diffMs = now.getTime() - new Date(iso).getTime();
    const diffMins = Math.floor(diffMs / (60 * 1000));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <div className="w-full px-margin py-margin">
      <div className="flex flex-col w-full">
        {/* 1. Alert Banner */}
        {latestChatWithAlarm && (
          <section className="w-full mb-space-lg">
            <Card accent="orange" className="p-space-md flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md">
              <div className="flex items-center gap-space-md">
                <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary-container flex-shrink-0 shadow-inner">
                  <span className="material-symbols-outlined text-[24px]">warning</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-space-xs flex-wrap">
                    <Badge variant="warning">Active Alarm Diagnosis</Badge>
                    <span className="text-tertiary-container">•</span>
                    <span className="font-code-sm text-code-sm font-semibold text-on-surface">
                      Alarm {latestChatWithAlarm.detectedAlarm}
                    </span>
                  </div>
                  <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">
                    Last diagnosis: <strong className="text-primary font-mono">{latestChatWithAlarm.detectedAlarm}</strong> on{' '}
                    <span className="text-secondary font-mono">{latestChatWithAlarm.controller || preferredControllerName}</span>.{' '}
                    {latestChatWithAlarm.title}
                  </p>
                </div>
              </div>
              <ButtonPrimary
                onClick={() => onNavigate('agent', { chatId: latestChatWithAlarm.link })}
                icon="arrow_forward"
                className="w-full md:w-auto"
              >
                Continue
              </ButtonPrimary>
            </Card>
          </section>
        )}

        {/* 2. Header & Live Telemetry */}
        <section className="w-full mb-space-xl">
          <PageHeader
            label="Operational Sync Active"
            title={`${greeting}, ${firstName}`}
            caption={`${dateFormatted} | ${shiftName} • ${preferredControllerName} Cell`}
            actions={
              <div className="flex flex-wrap items-center gap-space-sm">
                <StatChip icon="smart_toy" label="Questions today" value={questionsToday} variant="secondary" />
                <StatChip icon="calculate" label="Calculations today" value={calcsToday} variant="secondary" />
                <StatChip icon="terminal" label="Programs verified" value={verifiedToday} variant="primary" />
                <StatChip 
                  icon="school" 
                  label="Crash Lab" 
                  value={academy ? academy.level : 'Trainee'} 
                  variant="secondary"
                  onClick={() => onNavigate('academy')}
                />
              </div>
            }
          />
        </section>

        {/* 4. Quick Actions Core Grid */}
        <section className="grid grid-cols-1 gap-space-md mb-space-xl sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {/* Card 1: Diagnose Alarm */}
          <Card
            accent="orange"
            onClick={() => onNavigate('agent', { openCamera: true })}
            className="p-space-lg flex flex-col justify-between min-h-[180px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-14 h-14 rounded-xl bg-surface-container flex items-center justify-center text-primary-container shadow-md group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[32px]">photo_camera</span>
              </div>
              <IconButton icon="north_east" onClick={(e) => { e.stopPropagation(); onNavigate('agent', { openCamera: true }); }} className="w-10 h-10 min-w-0 min-h-0" />
            </div>
            <div className="mt-space-md">
              <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight group-hover:text-primary transition-colors">
                Diagnose Alarm
              </h2>
              <p className="font-body-sm text-body-sm text-tertiary mt-1">
                Capture terminal photo or paste Fanuc/Haas alarm code for instant physics verification.
              </p>
            </div>
          </Card>

          {/* Card 2: Calculate Feeds */}
          <Card
            accent="cyan"
            onClick={() => onNavigate('calculator')}
            className="p-space-lg flex flex-col justify-between min-h-[180px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-14 h-14 rounded-xl bg-surface-container flex items-center justify-center text-secondary shadow-md group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[32px]">calculate</span>
              </div>
              <IconButton icon="north_east" onClick={(e) => { e.stopPropagation(); onNavigate('calculator'); }} className="w-10 h-10 min-w-0 min-h-0" />
            </div>
            <div className="mt-space-md">
              <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight group-hover:text-secondary transition-colors">
                Calculate Feeds
              </h2>
              <p className="font-body-sm text-body-sm text-tertiary mt-1">
                Optimize spindle RPM, chip load (fz), and cutting power with Kienzle force physics.
              </p>
            </div>
          </Card>

          {/* Card 3: Verify G-Code */}
          <Card
            accent="green"
            onClick={() => onNavigate('gcode')}
            className="p-space-lg flex flex-col justify-between min-h-[180px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-14 h-14 rounded-xl bg-surface-container flex items-center justify-center text-secondary-fixed shadow-md group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[32px]">terminal</span>
              </div>
              <IconButton icon="north_east" onClick={(e) => { e.stopPropagation(); onNavigate('gcode'); }} className="w-10 h-10 min-w-0 min-h-0" />
            </div>
            <div className="mt-space-md">
              <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight group-hover:text-secondary-fixed transition-colors">
                Verify G-Code
              </h2>
              <p className="font-body-sm text-body-sm text-tertiary mt-1">
                Simulate toolpath backplot, inspect modal codes, and catch rapid plunges into raw stock.
              </p>
            </div>
          </Card>

          {/* Card 4: Academy Crash Lab */}
          <Card
            accent="cyan"
            onClick={() => onNavigate('academy')}
            className="p-space-lg flex flex-col justify-between min-h-[180px]"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-space-xs">
                <div className="w-14 h-14 rounded-xl bg-surface-container flex items-center justify-center text-secondary shadow-md group-hover:scale-105 transition-transform">
                  <span className="material-symbols-outlined text-[32px]">school</span>
                </div>
                <Badge variant="secondary">{academy ? academy.level : 'Trainee'}</Badge>
              </div>
              <IconButton icon="north_east" onClick={(e) => { e.stopPropagation(); onNavigate('academy'); }} className="w-10 h-10 min-w-0 min-h-0" />
            </div>
            <div className="mt-space-md">
              <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight group-hover:text-secondary transition-colors">
                Crash Lab
              </h2>
              <p className="font-body-sm text-body-sm text-tertiary mt-1">
                Interactive CNC training simulator, physics failure challenges, and shopfloor skill drills.
              </p>
            </div>
          </Card>

          {/* Card 5: Knowledge Base (Admins Only) */}
          {isAdmin && (
            <Card
              accent="amber"
              onClick={() => onNavigate('kb')}
              className="p-space-lg flex flex-col justify-between min-h-[180px]"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-space-xs">
                  <div className="w-14 h-14 rounded-xl bg-surface-container flex items-center justify-center text-tertiary-fixed shadow-md group-hover:scale-105 transition-transform">
                    <span className="material-symbols-outlined text-[32px]">menu_book</span>
                  </div>
                  <Badge variant="warning">ADMIN</Badge>
                </div>
                <IconButton icon="north_east" onClick={(e) => { e.stopPropagation(); onNavigate('kb'); }} className="w-10 h-10 min-w-0 min-h-0" />
              </div>
              <div className="mt-space-md">
                <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight group-hover:text-primary transition-colors">
                  Knowledge Base
                </h2>
                <p className="font-body-sm text-body-sm text-tertiary mt-1">
                  Upload OEM controller manuals, tool catalogs, & shop standards for AI retrieval.
                </p>
              </div>
            </Card>
          )}
        </section>

        {/* 5. Visual Activity Telemetry & Last Screen Snapshot Block */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg mb-space-xl">
          <Card className="p-space-lg flex flex-col justify-between relative overflow-hidden">
            <SectionHeader 
              title="Copilot Activity, last 7 days" 
              icon="troubleshoot"
              actions={
                <div className="flex items-center gap-space-xs">
                  <span className="font-label-sm text-label-sm font-mono text-tertiary uppercase">Buffer: 7 Days</span>
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
                </div>
              }
            />

            {/* SVG Area Chart */}
            <div className="relative w-full h-48 my-space-sm bg-surface-container-lowest rounded-lg p-space-sm flex items-center justify-center overflow-hidden border border-outline-variant/40">
              <svg className="w-full h-full text-secondary" fill="none" preserveAspectRatio="none" viewBox="0 0 700 140">
                <line stroke="currentColor" strokeDasharray="4 4" strokeOpacity="0.08" x1="0" x2="700" y1="35" y2="35" />
                <line stroke="currentColor" strokeDasharray="4 4" strokeOpacity="0.08" x1="0" x2="700" y1="70" y2="70" />
                <line stroke="currentColor" strokeDasharray="4 4" strokeOpacity="0.08" x1="0" x2="700" y1="105" y2="105" />
                <defs>
                  <linearGradient id="copilotLoadGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#5de6ff" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#5de6ff" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="copilotOverloadGrad" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="70%" stopColor="#5de6ff" />
                    <stop offset="90%" stopColor="#ff7a1a" />
                    <stop offset="100%" stopColor="#ff7a1a" />
                  </linearGradient>
                </defs>
                <path d={svgAreaPath} fill="url(#copilotLoadGrad)" />
                <path d={svgLinePath} fill="none" stroke="url(#copilotOverloadGrad)" strokeWidth="2.5" />
                <circle className="fill-primary-container stroke-surface-container-lowest" cx="700" cy="35" r="4" strokeWidth="2" />
              </svg>

              <div className="absolute top-3 left-4 flex items-center gap-space-sm bg-surface-container/80 backdrop-blur px-2.5 py-1 rounded">
                <span className="font-label-sm text-label-sm font-mono text-tertiary">ACTIVITY TODAY:</span>
                <span className="font-code-sm text-code-sm font-bold text-secondary">{currentDayVal} OPS</span>
              </div>

              <div className="absolute top-3 right-4 flex items-center gap-space-xs bg-surface-container/90 backdrop-blur px-2.5 py-1 rounded border border-primary-container/30">
                <span className="material-symbols-outlined text-[14px] text-primary-container">insights</span>
                <span className="font-label-sm text-label-sm font-mono text-primary-container font-bold">
                  PEAK: {maxVal} OPS/DAY
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm pt-space-xs">
              <StatChip label="Total Chats" value={totalChats} />
              <StatChip label="Calculations" value={totalCalcs} />
              <StatChip label="Verified" value={totalVerified} />
              <StatChip label="Avoided" value={crashesAvoided} variant="secondary" />
            </div>
          </Card>

          <Card className="p-space-lg flex flex-col justify-between">
            <SectionHeader 
              title="Last screen snapshot" 
              icon="videocam"
              actions={
                <div className="flex items-center gap-space-xs">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
                  <Badge variant="secondary">{lastSnapshot ? 'CAPTURED' : 'STANDBY'}</Badge>
                </div>
              }
            />

            <div className="relative w-full h-48 my-space-sm rounded-lg overflow-hidden bg-surface-container-lowest border border-outline-variant/40 flex items-center justify-center">
              {lastSnapshot ? (
                <>
                  <img className="w-full h-full object-cover" alt="Latest CNC Controller Snapshot" src={lastSnapshot.url} />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/90 via-transparent to-transparent"></div>
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                    <span className="font-label-sm text-label-sm font-mono text-on-surface font-semibold bg-surface-container-lowest/80 px-2 py-0.5 rounded truncate max-w-[280px]">
                      {lastSnapshot.caption || 'CNC PENDANT CAPTURE'}
                    </span>
                    <button onClick={() => onNavigate('agent')} className="font-code-sm text-code-sm text-secondary font-mono hover:underline flex items-center gap-1 cursor-pointer">
                      <span>Diagnose</span>
                      <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState 
                  icon="photo_camera"
                  title="No snapshot yet"
                  description="Snap a controller screen in the Agent to diagnose it."
                  action={
                    <ButtonSecondary onClick={() => onNavigate('agent', { openCamera: true })} icon="camera">
                      Open Agent Camera
                    </ButtonSecondary>
                  }
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-space-sm pt-space-xs">
              <StatChip label="Workpiece" value={profile?.preferredController ? `${preferredControllerName} Setup` : 'Standard'} />
              <StatChip label="Diagnostics" value={totalChats} variant="secondary" />
            </div>
          </Card>
        </section>

        {/* 6. Recent Activity & Shop Logs */}
        <Card className="p-space-lg mb-space-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-md pb-space-md">
            <SectionHeader title="Recent Activity & Shop Logs" icon="history" className="border-b-0 mb-0 pb-0" />

            <Tabs 
              activeTab={activeTab}
              onTabChange={(id) => setActiveTab(id as any)}
              tabs={[
                { id: 'all', label: `All (${activities.length})` },
                { id: 'calc', label: 'Calculations' },
                { id: 'alarm', label: 'Alarms' },
                { id: 'gcode', label: 'Simulations' },
              ]}
            />
          </div>

          {/* Activity Item Rows */}
          <div className="flex flex-col">
            {filteredActivities.length === 0 ? (
              <EmptyState 
                icon="folder_open"
                title="No activity yet"
                description="Start with a quick action above to compute speeds, diagnose an alarm, or verify G-code."
              />
            ) : (
              filteredActivities.map((item) => (
                <div
                  key={item.id}
                  className="py-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-md bg-surface-container/30 hover:bg-surface-container/60 px-space-md rounded-lg my-1 transition-colors border border-outline-variant/20"
                >
                  <div className="flex items-center gap-space-md min-w-0">
                    <div
                      className={`w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center flex-shrink-0 ${
                        item.type === 'calc'
                          ? 'text-secondary'
                          : item.type === 'chat'
                          ? 'text-primary-container'
                          : item.type === 'gcode'
                          ? 'text-secondary-container'
                          : 'text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[24px]">
                        {item.type === 'calc' && 'engineering'}
                        {item.type === 'chat' && 'crisis_alert'}
                        {item.type === 'gcode' && 'check_circle'}
                        {item.type === 'academy' && 'school'}
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-space-xs flex-wrap">
                        <span className="font-headline-sm text-headline-sm font-bold text-on-surface truncate">
                          {item.title}
                        </span>
                        {item.alarm && (
                          <span className="px-space-xs py-0.5 rounded bg-surface-container-high text-primary font-label-sm text-label-sm font-mono uppercase">
                            ALARM {item.alarm}
                          </span>
                        )}
                      </div>
                      <span className="font-code-sm text-code-sm text-tertiary truncate mt-0.5">
                        {getRelativeTime(item.createdAt)} •{' '}
                        <span className="text-secondary font-medium">{item.summary || 'Completed operation'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-space-sm flex-shrink-0 self-end md:self-auto">
                    {item.type === 'calc' && (
                      <button
                        onClick={() => onNavigate('calculator')}
                        className="h-10 px-space-md rounded-lg bg-primary-container/15 text-primary hover:bg-primary-container/25 transition-colors font-code-sm text-code-sm font-semibold flex items-center gap-space-xs cursor-pointer"
                        type="button"
                      >
                        <span>Resume</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </button>
                    )}
                    {item.type === 'chat' && (
                      <button
                        onClick={() => onNavigate('agent', { chatId: item.link })}
                        className="h-10 px-space-md rounded-lg bg-surface-container-high text-tertiary hover:text-on-surface hover:bg-surface-variant transition-colors font-code-sm text-code-sm font-semibold flex items-center gap-space-xs cursor-pointer"
                        type="button"
                      >
                        <span>View Diagnosis</span>
                        <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      </button>
                    )}
                    {item.type === 'gcode' && (
                      <button
                        onClick={() => onNavigate('gcode')}
                        className="h-10 px-space-md rounded-lg bg-secondary/10 text-secondary hover:bg-secondary/20 transition-colors font-code-sm text-code-sm font-semibold flex items-center gap-space-xs cursor-pointer"
                        type="button"
                      >
                        <span>Open Verifier</span>
                        <span className="material-symbols-outlined text-[16px]">play_circle</span>
                      </button>
                    )}
                    {item.type === 'academy' && (
                      <button
                        onClick={() => onNavigate('academy')}
                        className="h-10 px-space-md rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-code-sm text-code-sm font-semibold flex items-center gap-space-xs cursor-pointer"
                        type="button"
                      >
                        <span>Crash Lab</span>
                        <span className="material-symbols-outlined text-[16px]">school</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* 7. Pinned Manuals & Shop Standards Grid */}
        <section className="w-full">
          <SectionHeader 
            title="Pinned Manuals & Shop Standards" 
            icon="menu_book"
            actions={
              isAdmin && (
                <ButtonSecondary onClick={() => onNavigate('kb')} icon="bookmark_add">
                  + Pin Manual
                </ButtonSecondary>
              )
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
            {manuals.length === 0 ? (
              <Card className="col-span-full">
                <EmptyState 
                  icon="library_books"
                  title="No manuals uploaded yet"
                  description={isAdmin ? 'Upload OEM controller manuals and shop standard PDFs in the Knowledge Base.' : 'Your shop administrator will upload controller manuals for AI retrieval.'}
                  action={
                    isAdmin && (
                      <ButtonPrimary onClick={() => onNavigate('kb')} icon="upload_file">
                        Upload First Manual
                      </ButtonPrimary>
                    )
                  }
                />
              </Card>
            ) : (
              manuals.map((docItem) => (
                <Card 
                  key={docItem.id} 
                  onClick={() => onNavigate('agent', { manualQuery: docItem.name })}
                  className="p-space-md flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-secondary group-hover:scale-105 transition-transform">
                      <span className="material-symbols-outlined text-[20px]">auto_stories</span>
                    </div>
                    <Badge variant="secondary">{docItem.controller}</Badge>
                  </div>
                  <div className="mt-space-md">
                    <h4 className="font-headline-sm text-headline-sm font-bold text-on-surface group-hover:text-primary transition-colors line-clamp-2">
                      {docItem.name}
                    </h4>
                    <span className="font-code-sm text-code-sm text-tertiary mt-1 block font-mono">
                      {docItem.docType} • {docItem.pages ? `${docItem.pages} pages` : 'Indexed'}
                    </span>
                  </div>
                </Card>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
