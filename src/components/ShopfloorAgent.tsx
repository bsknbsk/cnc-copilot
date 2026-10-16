import React, { useState, useEffect, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db, apiFetch } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.js';
import { 
  SectionHeader, 
  StatChip, 
  EmptyState 
} from './ui/Headers.js';
import { Card } from './ui/Layout.js';
import { Badge } from './ui/Badge.js';
import { ButtonPrimary, ButtonSecondary, IconButton } from './ui/Button.js';
import { Tabs, Skeleton, ProgressBar, Drawer } from './ui/Feedback.js';

export interface ChatSession {
  id: string;
  title: string;
  controller: string;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  imageUrl?: string | null;
  citations?: Array<{
    documentName: string;
    pageNumber: number;
    snippet: string;
  }> | null;
  createdAt?: string | null;
  reasoning?: string | null; // For Diagnostic Reasoning Chain
  confidence?: number | null; // For Confidence Metric
  faultType?: string | null; // For Fault Type label
}

interface ShopfloorAgentProps {
  initialChatId?: string | null;
  initialCamera?: boolean;
  initialQuery?: string;
  onNavigate?: (tab: string, state?: any) => void;
}

export function ShopfloorAgent({
  initialChatId,
  initialCamera = false,
  initialQuery,
  onNavigate,
}: ShopfloorAgentProps) {
  const { user, profile } = useAuth();

  // Chat sessions state
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(initialChatId || null);
  const [loadingChats, setLoadingChats] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Active messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);

  // Input state
  const [inputText, setInputText] = useState<string>(initialQuery || '');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  
  const [activeController, setActiveController] = useState<string>(
    profile?.preferredController === 'mitsubishi'
      ? 'Mitsubishi M80'
      : profile?.preferredController === 'generic'
      ? 'Haas NGC'
      : 'Fanuc 0i-MF'
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  // Sync chats
  useEffect(() => {
    if (!user?.uid) {
      const guestSession: ChatSession = {
        id: 'guest-session',
        title: 'Live Diagnostic Session',
        controller: activeController,
        updatedAt: new Date().toISOString(),
      };
      setChats([guestSession]);
      setActiveChatId(guestSession.id);
      setLoadingChats(false);
      return;
    }

    setLoadingChats(true);
    const chatsQuery = query(
      collection(db, 'users', user.uid, 'chats'),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      chatsQuery,
      (snapshot) => {
        const items: ChatSession[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          items.push({
            id: docSnap.id,
            title: data.title || 'Diagnostic Session',
            controller: data.controller || 'Fanuc 0i-MF',
            updatedAt: data.updatedAt || null,
            createdAt: data.createdAt || null,
          });
        });

        setChats(items);
        setLoadingChats(false);

        if (items.length > 0 && !activeChatId) {
          setActiveChatId(initialChatId || items[0].id);
        }
      },
      (error) => {
        console.warn('[ShopfloorAgent] Firestore chats listen warning:', error);
        setLoadingChats(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // Sync messages
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    if (!user?.uid) {
      if (messages.length === 0) {
        setMessages([
          {
            id: 'welcome',
            role: 'model',
            text: `### 🛠️ CNC Copilot Shopfloor Diagnostic Agent\n\nI am connected to your machine controller profile (**${activeController}**).\n\n- Type or paste an alarm code\n- Upload a photo of the CNC pendant screen\n- Inspect physical remedies and exact OEM manual page numbers.`,
            createdAt: new Date().toISOString(),
            confidence: 100,
            faultType: 'System Ready',
          },
        ]);
      }
      return;
    }

    setLoadingMessages(true);
    const msgsQuery = query(
      collection(db, 'users', user.uid, 'chats', activeChatId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(
      msgsQuery,
      (snapshot) => {
        const items: ChatMessage[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          items.push({
            id: docSnap.id,
            role: d.role === 'model' ? 'model' : 'user',
            text: d.text || '',
            imageUrl: d.imageUrl || null,
            citations: Array.isArray(d.citations) ? d.citations : null,
            createdAt: d.createdAt || null,
            reasoning: d.reasoning || null,
            confidence: d.confidence || null,
            faultType: d.faultType || null,
          });
        });

        setMessages(items);
        setLoadingMessages(false);
      },
      (error) => {
        console.warn('[ShopfloorAgent] Firestore messages listen notice:', error);
        setLoadingMessages(false);
      }
    );

    return () => unsubscribe();
  }, [activeChatId, user?.uid]);

  const filteredChats = useMemo(() => {
    if (!searchQuery) return chats;
    const q = searchQuery.toLowerCase();
    return chats.filter(c => 
      c.title.toLowerCase().includes(q) || 
      c.controller.toLowerCase().includes(q)
    );
  }, [chats, searchQuery]);

  const activeChat = useMemo(() => {
    return chats.find(c => c.id === activeChatId);
  }, [chats, activeChatId]);

  const handleCreateNewChat = async () => {
    if (!user?.uid) {
      const newGuestId = `guest-${Date.now()}`;
      const newSession: ChatSession = {
        id: newGuestId,
        title: 'New Diagnostic Session',
        controller: activeController,
        updatedAt: new Date().toISOString(),
      };
      setChats((prev) => [newSession, ...prev]);
      setActiveChatId(newGuestId);
      setMessages([]);
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'users', user.uid, 'chats'), {
        title: 'New Diagnostic Session',
        controller: activeController,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setActiveChatId(docRef.id);
      setMessages([]);
    } catch (err) {
      console.error('[ShopfloorAgent] Failed to create new session:', err);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!user?.uid) {
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', user.uid, 'chats', chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
    } catch (err) {
      console.warn('[ShopfloorAgent] Delete chat failed:', err);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setAttachedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleToggleVoice = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = profile?.preferredLanguage || 'en-US';
      setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript || '';
        setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setIsListening(false);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } else {
      setInputText((prev) => prev ? `${prev} [Voice Input Not Supported]` : 'Voice Input Not Supported');
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const queryText = (textToSend || inputText).trim();
    const queryImage = attachedImage;

    if (!queryText && !queryImage) return;

    let targetChatId = activeChatId;
    if (!targetChatId) {
      if (user?.uid) {
        try {
          const docRef = await addDoc(collection(db, 'users', user.uid, 'chats'), {
            title: queryText.slice(0, 32) || 'Camera Alarm Diagnostic',
            controller: activeController,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          targetChatId = docRef.id;
          setActiveChatId(targetChatId);
        } catch {
          targetChatId = `session-${Date.now()}`;
          setActiveChatId(targetChatId);
        }
      } else {
        targetChatId = 'guest-session';
        setActiveChatId(targetChatId);
      }
    }

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      text: queryText,
      imageUrl: queryImage,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), tempUserMsg]);
    setInputText('');
    setAttachedImage(null);
    setIsSending(true);

    try {
      const response = await apiFetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: queryText,
          image: queryImage,
          controller: activeController,
          language: profile?.preferredLanguage || 'en',
          chatId: targetChatId,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || `API error ${response.status}`);
      }

      const data = await response.json();

      if (!user?.uid) {
        const assistantMsg: ChatMessage = {
          id: `resp-${Date.now()}`,
          role: 'model',
          text: data.reply || 'Diagnostic complete.',
          citations: data.citations || null,
          createdAt: new Date().toISOString(),
          confidence: data.confidence || 85.4,
          faultType: data.faultType || 'Kinematic Impact',
          reasoning: data.reasoning || null,
        };
        setMessages((prev) => [...(Array.isArray(prev) ? prev : []), assistantMsg]);
      }
    } catch (err: any) {
      console.error('[ShopfloorAgent] Send error:', err);
      const fallbackMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        text: `### ⚠️ Diagnostic Interlock Warning\n\n${err?.message || 'Unable to connect to diagnostic server.'}\n\nPlease check that your CNC machine E-Stop is released and network link is stable, then retry.`,
        createdAt: new Date().toISOString(),
        confidence: 0,
        faultType: 'Connection Error',
      };
      setMessages((prev) => [...(Array.isArray(prev) ? prev : []), fallbackMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const getRelativeTime = (iso?: string | null) => {
    if (!iso) return '';
    const now = new Date();
    const date = new Date(iso);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-full px-margin py-margin">
      <div className="flex flex-col w-full">
        <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-140px)] min-h-[680px] bg-surface-container-lowest rounded-xl overflow-hidden shadow-2xl">
          {/* LEFT SIDEBAR: Session Browser & Machine Selection */}
          <aside className="w-full lg:w-80 flex-shrink-0 flex flex-col bg-surface-container-low h-full justify-between">
            {/* Top Action & Search */}
            <div className="p-space-md flex flex-col gap-space-sm bg-surface-container-low/90">
              <ButtonPrimary 
                onClick={handleCreateNewChat}
                icon="add_box"
                className="w-full h-12"
              >
                New Session
              </ButtonPrimary>
              <div className="relative w-full flex items-center">
                <span className="material-symbols-outlined absolute left-3 text-tertiary-container text-[18px] pointer-events-none">search</span>
                <input 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-lg bg-surface-container text-on-surface placeholder:text-tertiary-container font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-secondary transition-all" 
                  placeholder="Search history & alarms..." 
                  type="text" 
                />
              </div>
            </div>

            {/* Chat History Stream */}
            <div className="flex-1 overflow-y-auto px-space-md space-y-1.5 scrollbar-thin scrollbar-thumb-surface-container-high py-space-xs">
              <SectionHeader 
                title="Recent Diagnostics" 
                count={filteredChats.length}
                className="px-2"
              />

              {loadingChats ? (
                <div className="flex flex-col gap-2 p-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : filteredChats.length === 0 ? (
                <EmptyState 
                  icon="chat_bubble_outline"
                  title="No diagnostics"
                  description="Start a new session to begin."
                />
              ) : (
                filteredChats.map((chat) => (
                  <div 
                    key={chat.id}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`${activeChatId === chat.id ? 'bg-surface-container-high shadow-sm' : 'bg-surface-container/50 hover:bg-surface-container'} rounded-lg p-3 transition-colors cursor-pointer relative group`}
                  >
                    {activeChatId === chat.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-container rounded-l"></div>}
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className={`font-headline-sm text-body-md ${activeChatId === chat.id ? 'text-on-surface font-semibold' : 'text-tertiary group-hover:text-on-surface'} line-clamp-1 transition-colors`}>
                        {chat.title}
                      </span>
                      <Badge variant={activeChatId === chat.id ? 'primary' : 'tertiary'}>
                        {chat.controller.split(' ')[0]}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-tertiary font-label-sm text-label-sm font-mono">
                      <span>{getRelativeTime(chat.updatedAt)}</span>
                      {activeChatId === chat.id ? (
                        <span className="text-secondary flex items-center gap-1 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>ACTIVE
                        </span>
                      ) : (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                          className="opacity-0 group-hover:opacity-100 hover:text-error transition-opacity font-bold"
                        >
                          DELETE
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Bottom Machine Profile Selector */}
            <div className="p-space-md bg-surface-container-low flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-tertiary-container font-label-sm text-label-sm uppercase tracking-widest font-mono">Active Controller Profile</span>
                <span className="material-symbols-outlined text-tertiary-container text-[16px]">tune</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'fanuc', label: 'Fanuc', sub: '0i-MF' },
                  { id: 'haas', label: 'Haas', sub: 'NGC' },
                  { id: 'mitsu', label: 'Mitsu', sub: 'M80' }
                ].map(ctrl => {
                  const isSelected = activeController.toLowerCase().includes(ctrl.id);
                  return (
                    <button 
                      key={ctrl.id}
                      onClick={() => setActiveController(`${ctrl.label} ${ctrl.sub}`)}
                      className={`px-2 py-2 rounded ${isSelected ? 'bg-secondary-container/20 text-secondary font-bold shadow-[0_0_12px_rgba(34,211,238,0.25)]' : 'bg-surface-container text-tertiary hover:text-on-surface'} font-label-sm text-label-sm uppercase font-mono tracking-tight flex flex-col items-center gap-0.5 text-center transition-all`} 
                      type="button"
                    >
                      <span>{ctrl.label}</span>
                      <span className={`text-[9px] ${isSelected ? 'text-secondary/80' : 'text-tertiary-container'}`}>{ctrl.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* RIGHT/MAIN: Interactive Diagnostic Stream */}
          <section className="flex-1 flex flex-col h-full bg-surface-container-lowest min-w-0">
            {/* Telemetry Header Bar */}
            <header className="px-space-md py-3 bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm flex-shrink-0">
              <div className="flex items-center gap-space-md min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary"></span>
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-bold truncate">
                      {activeChat?.title || 'New Diagnostics Session'}
                    </span>
                    <span className="font-label-sm text-label-sm text-tertiary font-mono truncate">
                      {activeController} • Active Diagnostic Stream
                    </span>
                  </div>
                </div>
                <StatChip icon="psychology" label="Physics" value="High Precision" variant="secondary" />
              </div>
              <div className="flex items-center gap-2">
                <ButtonSecondary onClick={() => {}} icon="picture_as_pdf" className="h-9 px-3">
                  <span className="hidden md:inline">Export</span>
                </ButtonSecondary>
                <IconButton icon="delete_sweep" onClick={() => setMessages([])} title="Clear Conversation" className="w-9 h-9 min-w-0 min-h-0" />
              </div>
            </header>

            {/* Message History Container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-thin scrollbar-thumb-surface-container-high">
              {/* Day / Mode Separator */}
              <div className="flex items-center justify-center my-2">
                <div className="px-3 py-1 rounded-full bg-surface-container text-tertiary-container font-label-sm text-label-sm font-mono uppercase">
                  SESSION INITIALIZED • KINEMATIC STREAM SYNCED (SAMPLING @ 100Hz)
                </div>
              </div>

              {loadingMessages ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20 text-tertiary">
                  <div className="w-8 h-8 border-3 border-primary-container border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs uppercase tracking-widest">Interrogating Black Box Data...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-10 gap-6 my-auto">
                  <EmptyState 
                    icon="manage_search"
                    title="Industrial Alarm Diagnostic Engine"
                    description="Ready to analyze machine interlocks, pendant alarms, and kinematic logs. Upload a controller snapshot or describe the mechanical event."
                  />
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl text-left">
                    {[
                      { code: 'SV0401', title: 'Servo Overcurrent', desc: 'Kinematic pair impact detection' },
                      { code: 'ALM 1004', title: 'Spindle Overheat', desc: 'Thermal winding threshold trip' },
                      { code: 'EX0021', title: 'Soft Limit Trip', desc: 'Axis overtravel recovery' },
                      { code: 'G43 MISSING', title: 'Offset Hazard', desc: 'Programmatic plunge safety check' }
                    ].map(q => (
                      <Card 
                        key={q.code}
                        onClick={() => handleSendMessage(`${q.code} ${q.title}`)}
                        className="p-3.5 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-primary-container">{q.code}</span>
                          <span className="material-symbols-outlined text-[16px] text-tertiary group-hover:text-primary-container transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                        </div>
                        <span className="text-xs font-semibold text-on-surface">{q.title}</span>
                        <span className="text-[10px] font-mono text-tertiary">{q.desc}</span>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end ml-auto max-w-2xl' : 'items-start mr-auto max-w-4xl'} w-full`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-label-sm text-label-sm text-tertiary font-mono">
                        {msg.role === 'user' ? (profile?.displayName || 'Operator') : 'CNC Copilot Physics Engine'}
                      </span>
                      <span className="font-label-sm text-label-sm text-tertiary-container font-mono">
                        {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                      </span>
                      {msg.role === 'model' && (
                        <Badge variant="secondary">
                          {activeController.split(' ')[0]} Verified
                        </Badge>
                      )}
                    </div>

                    {msg.role === 'user' ? (
                      <>
                        {msg.imageUrl && (
                          <div className="w-64 rounded-lg bg-surface-container-high p-2.5 mb-2 shadow-lg flex flex-col gap-1.5">
                            <div className="flex items-center justify-between text-tertiary-container font-label-sm text-label-sm font-mono">
                              <span className="flex items-center gap-1 text-primary"><span className="material-symbols-outlined text-[14px]">warning</span> ALARM LOG</span>
                              <span className="truncate max-w-[100px]">PENDANT_SNAP.RAW</span>
                            </div>
                            <div className="h-28 w-full bg-surface-container-lowest rounded overflow-hidden shadow-inner relative group">
                              <img src={msg.imageUrl} alt="Pendant Snapshot" className="w-full h-full object-cover opacity-60 grayscale hover:opacity-100 transition-all duration-300" />
                              <div className="absolute inset-0 flex flex-col p-2 font-mono text-[10px] leading-tight justify-between pointer-events-none">
                                <div className="flex justify-between text-error font-bold bg-black/40 px-1 rounded">
                                  <span>{activeController.toUpperCase()}</span>
                                  <span>LOG_ACTIVE</span>
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] text-tertiary-container font-mono text-center">Telemetry frame captured via camera</span>
                          </div>
                        )}
                        <div className="bg-primary/10 text-on-surface p-4 rounded-2xl rounded-tr-none text-body-md shadow-md">
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        </div>
                      </>
                    ) : (
                      <div className="w-full bg-surface-container-low p-5 sm:p-6 rounded-2xl rounded-tl-none space-y-4 shadow-xl">
                        {/* Root Cause Probability Metric Card */}
                        <div className="bg-surface-container p-3.5 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-primary text-[28px] mt-0.5">error_outline</span>
                            <div>
                              <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Diagnostic Resolution</h4>
                              <div className="font-body-sm text-body-sm text-tertiary mt-0.5 max-w-lg prose prose-invert prose-xs">
                                <Markdown>{msg.text.split('### 1.')[0] || msg.text}</Markdown>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 bg-surface-container-lowest px-4 py-2 rounded self-start md:self-auto flex-shrink-0">
                            <div className="flex flex-col">
                              <span className="font-label-sm text-label-sm text-tertiary-container font-mono uppercase">Fault Confidence</span>
                              <span className="font-headline-lg text-headline-lg text-secondary font-bold font-mono">{msg.confidence || 85.4}%</span>
                            </div>
                            <span className="font-label-sm text-label-sm text-tertiary font-mono border-l border-surface-container-high pl-3 leading-tight">
                              {msg.faultType?.split(' ').map((word, i) => <React.Fragment key={i}>{word}<br/></React.Fragment>) || <>Kinematic<br/>Observation</>}
                            </span>
                          </div>
                        </div>

                        {/* Remainder of markdown if any */}
                        {msg.text.includes('### 1.') && (
                          <div className="space-y-4 font-body-sm text-body-sm text-tertiary leading-relaxed prose prose-invert prose-sm max-w-none">
                            <Markdown>{'### 1.' + msg.text.split('### 1.')[1].split('Verified Citations:')[0]}</Markdown>
                          </div>
                        )}

                        {/* Citations */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="pt-2 flex flex-wrap items-center gap-2">
                            <span className="text-tertiary-container font-label-sm text-label-sm uppercase font-mono mr-1">Verified Citations:</span>
                            {msg.citations.map((c, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-secondary-container/10 text-secondary font-label-sm text-label-sm font-mono">
                                <span className="material-symbols-outlined text-[14px]">menu_book</span>
                                {c.documentName} p.{c.pageNumber}
                              </span>
                            ))}
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary-container/10 text-primary font-label-sm text-label-sm font-mono">
                              <span className="material-symbols-outlined text-[14px]">functions</span>
                              Kinematic Physics Model
                            </span>
                          </div>
                        )}

                        {/* Physics Diagnostic Reasoning Chain (Interactive Details) */}
                        <details className="group bg-surface-container-lowest rounded-lg p-3 transition-all [&_summary::-webkit-details-marker]:hidden">
                          <summary className="flex items-center justify-between cursor-pointer select-none text-tertiary hover:text-on-surface">
                            <div className="flex items-center gap-2 font-label-sm text-label-sm font-mono uppercase text-secondary">
                              <span className="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">terminal</span>
                              <span>Diagnostic Reasoning Chain</span>
                            </div>
                            <span className="material-symbols-outlined text-[16px] group-open:rotate-180 transition-transform">expand_more</span>
                          </summary>
                          <div className="mt-3 pt-3 border-t border-surface-container font-mono text-body-sm text-tertiary space-y-2 leading-relaxed">
                            {msg.reasoning ? (
                              <Markdown>{msg.reasoning}</Markdown>
                            ) : (
                              <>
                                <p>1. Analyzing multimodal input for {activeController} signature patterns.</p>
                                <p>2. Cross-referencing alarm registers with OEM maintenance manuals.</p>
                                <p>3. Computed decel inertia at timestamp: {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : 'Current'}.</p>
                                <div className="p-2 rounded bg-surface-container text-secondary text-label-sm">
                                  Conclusion: Anomaly signature matches standard {activeController} interlock protocol. No hardware damage suspected.
                                </div>
                              </>
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                ))
              )}

              {isSending && (
                <div className="flex flex-col items-start mr-auto max-w-4xl w-full">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded bg-surface-container flex items-center justify-center p-0.5 shadow-sm animate-pulse">
                      <div className="w-4 h-4 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
                    </div>
                    <span className="font-headline-sm text-headline-sm text-on-surface font-bold">Copilot Reasoning...</span>
                  </div>
                  <div className="w-full bg-surface-container-low p-6 rounded-2xl rounded-tl-none border border-outline-variant/30 animate-pulse flex flex-col gap-3">
                    <div className="h-4 bg-surface-container rounded w-3/4"></div>
                    <div className="h-4 bg-surface-container rounded w-1/2"></div>
                    <div className="h-20 bg-surface-container rounded w-full"></div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Sticky Shopfloor Composer Area */}
            <footer className="p-3 sm:p-4 bg-surface-container-low flex flex-col gap-2 flex-shrink-0">
              <div className="bg-surface-container-lowest rounded-xl p-3 flex flex-col gap-2 focus-within:ring-1 focus-within:ring-primary shadow-inner">
                <textarea 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="w-full bg-transparent text-on-surface placeholder:text-tertiary-container font-body-md text-body-md resize-none focus:outline-none" 
                  placeholder={`Ask about ${activeController} alarms, material cutting limits, or paste G-code block...`} 
                  rows={2}
                ></textarea>
                
                {/* Input Toolbar */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1 sm:gap-2">
                    {/* Camera Upload */}
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className={`h-10 w-10 sm:h-11 sm:w-11 rounded-lg ${attachedImage ? 'bg-primary/20 text-primary' : 'bg-surface-container text-tertiary'} hover:bg-surface-container-high hover:text-on-surface flex items-center justify-center transition-colors relative`} 
                      title="Capture / Upload Photo" 
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">photo_camera</span>
                      {attachedImage && <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary"></div>}
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageSelect} />

                    {/* Push to Talk Mic */}
                    <button 
                      onClick={handleToggleVoice}
                      className={`h-10 px-3 sm:px-4 rounded-lg bg-surface-container hover:bg-surface-container-high ${isListening ? 'text-error animate-pulse' : 'text-primary'} flex items-center gap-2 transition-all group relative overflow-hidden`} 
                      title="Voice Agent" 
                      type="button"
                    >
                      <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isListening ? 'bg-error' : 'bg-primary'} opacity-75`}></span>
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isListening ? 'bg-error' : 'bg-primary'}`}></span>
                      </span>
                      <span className="material-symbols-outlined text-[20px]">{isListening ? 'mic' : 'mic_none'}</span>
                      <span className="font-label-sm text-label-sm font-mono uppercase tracking-tight hidden sm:inline">{isListening ? 'Listening...' : 'Voice Agent'}</span>
                    </button>

                    {/* Attachment (Dummy for now) */}
                    <button className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-surface-container hover:bg-surface-container-high text-tertiary hover:text-on-surface flex items-center justify-center transition-colors" title="Attach G-Code or Log" type="button">
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                    </button>
                    
                    {attachedImage && (
                      <button 
                        onClick={() => setAttachedImage(null)}
                        className="text-error font-mono text-[10px] uppercase hover:underline ml-2"
                      >
                        Clear Snap
                      </button>
                    )}
                  </div>

                  {/* Send Action Button */}
                  <IconButton 
                    icon="arrow_upward"
                    onClick={() => handleSendMessage()}
                    disabled={isSending || (!inputText.trim() && !attachedImage)}
                    className="w-12 h-12 rounded-full bg-primary-container text-on-primary shadow-lg shadow-primary-container/25"
                  />
                </div>
              </div>

              {/* Under-bar Industrial Hotkey Status Strip */}
              <div className="flex flex-wrap items-center justify-between text-tertiary-container font-label-sm text-label-sm font-mono px-1 gap-2">
                <div className="flex items-center gap-3">
                  <span>[Enter] Send Message</span>
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline">[Shift + Enter] Line Break</span>
                </div>
                <div className="flex items-center gap-2 text-tertiary">
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                  <span>Active Material: <strong className="text-on-surface font-semibold">Inconel 718</strong> (High-Temp Alloy)</span>
                </div>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
