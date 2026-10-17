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
  setDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db, apiFetch } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.js';
import { 
  SectionHeader, 
  StatChip, 
  EmptyState 
} from './ui/Headers.js';
import { Card, GlassPanel } from './ui/Layout.js';
import { Badge } from './ui/Badge.js';
import { ButtonPrimary, ButtonSecondary, IconButton } from './ui/Button.js';
import { Tabs, Skeleton, ProgressBar, Drawer } from './ui/Feedback.js';

export interface ChatSession {
  id: string;
  title: string;
  controller: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  isPinned?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  imageUrl?: string | null;
  intent?: 'greeting' | 'general' | 'diagnosis' | 'calculation' | 'gcode' | null;
  diagnosis?: {
    alarmCode: string | null;
    alarmText: string | null;
    likelyCauses: string[];
    steps: string[];
    safetyNote: string | null;
  } | null;
  citations?: Array<{
    documentName: string;
    pageNumber?: number | null;
    snippet: string;
    docId?: string | null;
    fileUrl?: string | null;
  }> | null;
  toolCalls?: Array<{
    name: string;
    args: any;
    result: any;
  }> | null;
  createdAt?: string | null;
  reasoning?: string | null;
  confidence?: number | null;
  faultType?: string | null;
  isError?: boolean;
  failedQuery?: string;
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
  const { user, profile, updatePreferences } = useAuth();

  const LANGUAGES = [
    { code: 'en' as const, label: 'English', short: 'EN' },
    { code: 'hi' as const, label: 'हिन्दी (Hindi)', short: 'HI' },
    { code: 'ml' as const, label: 'മലയാളം (Malayalam)', short: 'ML' },
    { code: 'ta' as const, label: 'தமிழ் (Tamil)', short: 'TA' },
  ];

  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'hi' | 'ml' | 'ta'>(
    (profile?.preferredLanguage as any) || 'en'
  );
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // Chat sessions state
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(initialChatId || null);
  const [loadingChats, setLoadingChats] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 3-dot dropdown menu & hard delete modal state
  const [menuOpenChatId, setMenuOpenChatId] = useState<string | null>(null);
  const [chatToDelete, setChatToDelete] = useState<ChatSession | null>(null);

  // Active messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);

  // Input state
  const [inputText, setInputText] = useState<string>(initialQuery || '');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<{
    name: string;
    type: string;
    base64: string;
    size: number;
  } | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Voice recording state (MediaRecorder)
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  // Press-to-talk refs
  const autoSubmitRef = useRef<boolean>(false);
  const isLongPressRef = useRef<boolean>(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Camera modal state
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  
  const activeController = useMemo(() => {
    const ctrl = profile?.preferredController || 'fanuc';
    if (ctrl === 'mitsubishi') return 'Mitsubishi M80';
    if (ctrl === 'generic') return 'Generic ISO';
    return 'Fanuc 0i-MF';
  }, [profile?.preferredController]);

  const [selectedCitation, setSelectedCitation] = useState<{
    documentName: string;
    pageNumber?: number | null;
    snippet: string;
    fileUrl?: string | null;
  } | null>(null);
  const [signedImageUrls, setSignedImageUrls] = useState<Record<string, string>>({});
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const pathsToFetch = messages
      .filter((m) => m.imageUrl && m.imageUrl.startsWith('chats/') && !signedImageUrls[m.imageUrl])
      .map((m) => m.imageUrl as string);

    if (pathsToFetch.length === 0) return;

    pathsToFetch.forEach(async (path) => {
      try {
        const res = await apiFetch(`/api/agent/image?path=${encodeURIComponent(path)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            setSignedImageUrls((prev) => ({ ...prev, [path]: data.url }));
          }
        }
      } catch (err) {
        console.warn('[ShopfloorAgent] Failed to fetch signed URL:', err);
      }
    });
  }, [messages, signedImageUrls]);

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
            isPinned: Boolean(data.isPinned),
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
            intent: d.intent || null,
            diagnosis: d.diagnosis || null,
            citations: Array.isArray(d.citations) ? d.citations : null,
            toolCalls: Array.isArray(d.toolCalls) ? d.toolCalls : null,
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
    let list = chats;
    const globalCtrl = (profile?.preferredController || 'fanuc').toLowerCase();
    list = list.filter((c) => {
      const cCtrl = (c.controller || '').toLowerCase();
      if (globalCtrl === 'fanuc') return cCtrl.includes('fanuc');
      if (globalCtrl === 'mitsubishi') return cCtrl.includes('mitsu');
      if (globalCtrl === 'generic') return cCtrl.includes('generic') || cCtrl.includes('iso');
      return true;
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => 
        c.title.toLowerCase().includes(q) || 
        c.controller.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [chats, profile?.preferredController, searchQuery]);

  // Synchronize active chat when controller filter changes
  useEffect(() => {
    if (filteredChats.length > 0) {
      const exists = filteredChats.some((c) => c.id === activeChatId);
      if (!exists) {
        setActiveChatId(filteredChats[0].id);
      }
    }
  }, [filteredChats, activeChatId]);

  const activeChat = useMemo(() => {
    return chats.find(c => c.id === activeChatId);
  }, [chats, activeChatId]);

  const handleCreateNewChat = async () => {
    // 3a) Stop creating multiple blank sessions if already a blank session is open
    if (messages.length === 0 && activeChatId) {
      return;
    }
    if (chats.some((c) => c.id === activeChatId && messages.length === 0)) {
      return;
    }

    if (!user?.uid) {
      const newGuestId = `guest-${Date.now()}`;
      const newSession: ChatSession = {
        id: newGuestId,
        title: 'New Diagnostic Session',
        controller: activeController,
        updatedAt: new Date().toISOString(),
        isPinned: false,
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
        isPinned: false,
      });
      setActiveChatId(docRef.id);
      setMessages([]);
    } catch (err) {
      console.error('[ShopfloorAgent] Failed to create new session:', err);
    }
  };

  const handleTogglePinChat = async (chat: ChatSession) => {
    const newPinned = !chat.isPinned;
    setChats((prev) =>
      prev.map((c) => (c.id === chat.id ? { ...c, isPinned: newPinned } : c))
    );
    if (user?.uid) {
      try {
        await setDoc(
          doc(db, 'users', user.uid, 'chats', chat.id),
          { isPinned: newPinned },
          { merge: true }
        );
      } catch (err) {
        console.warn('[ShopfloorAgent] Pin chat update notice:', err);
      }
    }
  };

  const handleExportChat = async (chatSession?: ChatSession | null, msgsToExport?: ChatMessage[]) => {
    const session = chatSession || activeChat;
    if (!session) return;

    let exportMsgs = msgsToExport || messages;
    if (!msgsToExport && session.id !== activeChatId && user?.uid) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'chats', session.id, 'messages'),
            orderBy('createdAt', 'asc')
          )
        );
        const fetched: ChatMessage[] = [];
        snap.forEach((d) => {
          const data = d.data();
          fetched.push({
            id: d.id,
            role: data.role,
            text: data.text || '',
            intent: data.intent,
            diagnosis: data.diagnosis,
            citations: data.citations,
            createdAt: data.createdAt,
          });
        });
        if (fetched.length > 0) exportMsgs = fetched;
      } catch (err) {
        console.warn('[ShopfloorAgent] Export fetch messages notice:', err);
      }
    }

    const titleClean = session.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateFormatted = new Date().toISOString().split('T')[0];
    const operatorName = profile?.displayName || user?.displayName || 'Operator';

    let content = `# CNC Copilot Industrial Diagnostic Report\n\n`;
    content += `- **Session Title:** ${session.title}\n`;
    content += `- **Machine Controller:** ${session.controller}\n`;
    content += `- **Export Date:** ${new Date().toLocaleString()}\n`;
    content += `- **Operator:** ${operatorName}\n\n`;
    content += `---\n\n## Diagnostic Transcript\n\n`;

    if (exportMsgs.length === 0) {
      content += `*(No messages recorded in this diagnostic session)*\n`;
    } else {
      exportMsgs.forEach((m, idx) => {
        const roleLabel = m.role === 'user' ? `[Operator] ${operatorName}` : `[AI Copilot] CNC Copilot Physics Engine`;
        const timeLabel = m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : `Step ${idx + 1}`;
        content += `### ${roleLabel} (${timeLabel})\n\n`;
        content += `${m.text}\n\n`;

        if (m.diagnosis) {
          if (m.diagnosis.alarmCode || m.diagnosis.alarmText) {
            content += `**Alarm:** ${m.diagnosis.alarmCode || ''} ${m.diagnosis.alarmText || ''}\n\n`;
          }
          if (m.diagnosis.likelyCauses && m.diagnosis.likelyCauses.length > 0) {
            content += `**Likely Causes:**\n${m.diagnosis.likelyCauses.map((c) => `- ${c}`).join('\n')}\n\n`;
          }
          if (m.diagnosis.steps && m.diagnosis.steps.length > 0) {
            content += `**Remediation Steps:**\n${m.diagnosis.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`;
          }
          if (m.diagnosis.safetyNote) {
            content += `> **Safety Notice:** ${m.diagnosis.safetyNote}\n\n`;
          }
        }

        if (m.citations && m.citations.length > 0) {
          content += `**Verified Citations:**\n`;
          m.citations.forEach((c) => {
            content += `- **${c.documentName}**${c.pageNumber ? ` (Page ${c.pageNumber})` : ''}: "${c.snippet}"\n`;
          });
          content += `\n`;
        }
        content += `---\n\n`;
      });
    }

    content += `*Report generated by CNC Copilot v2.4 Core - AI explains. Physics decides.*\n`;

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CNC_Diagnostic_${session.controller.split(' ')[0]}_${titleClean}_${dateFormatted}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleConfirmDelete = async (chatId: string) => {
    // 1. Immediately remove from local state so UI updates instantly
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChatId === chatId) {
      const remaining = chats.filter((c) => c.id !== chatId);
      setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
      setMessages([]);
    }
    setChatToDelete(null);

    // 2. Perform server-authoritative and client-side deletion
    if (user?.uid) {
      try {
        await apiFetch(`/api/agent/chat/${chatId}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('[ShopfloorAgent] Server delete notice:', err);
      }

      try {
        const msgsSnap = await getDocs(
          collection(db, 'users', user.uid, 'chats', chatId, 'messages')
        );
        if (!msgsSnap.empty) {
          const batch = writeBatch(db);
          msgsSnap.forEach((docSnap) => batch.delete(docSnap.ref));
          await batch.commit();
        }
        await deleteDoc(doc(db, 'users', user.uid, 'chats', chatId));
      } catch (err) {
        console.warn('[ShopfloorAgent] Client delete notice:', err);
      }
    }
  };

  const processImageFile = (fileOrBlob: Blob | File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          const maxDim = 2048;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context unavailable'));
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(fileOrBlob);
    });
  };

  const getBase64ByteSize = (dataUrl: string): number => {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.round((base64.length * 3) / 4);
  };

  const handleStartCamera = async () => {
    setComposerError(null);
    setCameraError(null);
    setCapturedFrame(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraFallbackInputRef.current?.click();
      return;
    }

    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn('[ShopfloorAgent] Camera access error:', err);
      setCameraError('Camera blocked. Allow camera access in the browser address bar, then try again.');
    }
  };

  const handleCapturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    let width = video.videoWidth || 640;
    let height = video.videoHeight || 480;
    const maxDim = 2048;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedFrame(dataUrl);
  };

  const handleRetakePhoto = () => {
    setCapturedFrame(null);
    if (cameraStreamRef.current && videoRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
      videoRef.current.play().catch(() => {});
    }
  };

  const handleUsePhoto = () => {
    if (capturedFrame) {
      const byteSize = getBase64ByteSize(capturedFrame);
      if (byteSize > 5 * 1024 * 1024) {
        setComposerError('Image too large. Use a photo under 5 MB.');
      } else {
        setAttachedImage(capturedFrame);
      }
    }
    handleCloseCamera();
  };

  const handleCloseCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraOpen(false);
    setCapturedFrame(null);
    setCameraError(null);
  };

  const handleCameraFallbackSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const resized = await processImageFile(file);
      const size = getBase64ByteSize(resized);
      if (size > 5 * 1024 * 1024) {
        setComposerError('Image too large. Use a photo under 5 MB.');
        return;
      }
      setAttachedImage(resized);
    } catch (err) {
      console.warn('[ShopfloorAgent] Fallback camera error:', err);
    }
  };

  const handleAttachmentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'];
    if (!ALLOWED.includes(file.type)) {
      setComposerError('File must be JPG, PNG, WEBP, or PDF under 10 MB.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setComposerError('File must be JPG, PNG, WEBP, or PDF under 10 MB.');
      return;
    }

    setComposerError(null);

    if (file.type.startsWith('image/')) {
      try {
        const resized = await processImageFile(file);
        setAttachedImage(resized);
        setAttachedFile(null);
      } catch (err) {
        console.warn('[ShopfloorAgent] Attachment image process error:', err);
        setComposerError('Failed to process image file.');
      }
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.includes('base64,') ? result.split('base64,')[1] : result;
        setAttachedFile({
          name: file.name,
          type: file.type,
          size: file.size,
          base64,
        });
        setAttachedImage(null);
      };
      reader.onerror = () => setComposerError('Failed to read document.');
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    setComposerError(null);
    const preferredTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'];
    let chosenMime = '';
    for (const t of preferredTypes) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        chosenMime = t;
        break;
      }
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
    } catch (err: any) {
      console.warn('[ShopfloorAgent] Mic permission denied:', err);
      setComposerError('Microphone blocked. Allow microphone access in the browser address bar, then try again.');
      return;
    }

    try {
      const recorder = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach((t) => t.stop());
          micStreamRef.current = null;
        }
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        const mimeTypeToUse = recorder.mimeType || chosenMime || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeTypeToUse });
        if (audioBlob.size === 0) {
          setRecordingState('idle');
          return;
        }

        setRecordingState('transcribing');
        try {
          const formData = new FormData();
          const ext = mimeTypeToUse.includes('mp4') ? 'mp4' : mimeTypeToUse.includes('ogg') ? 'ogg' : 'webm';
          formData.append('audio', audioBlob, `speech.${ext}`);
          formData.append('language', selectedLanguage);

          const res = await apiFetch('/api/agent/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`Transcription failed: ${res.status}`);
          }
          const data = await res.json();
          if (data.transcript) {
            if (autoSubmitRef.current) {
              // Press and hold: submit directly
              handleSendMessage(data.transcript);
            } else {
              // Click toggle: append to input text
              setInputText((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript));
            }
          }
        } catch (err: any) {
          console.warn('[ShopfloorAgent] Transcribe error:', err);
          setComposerError('Could not transcribe audio. Please retry or speak closer to microphone.');
        } finally {
          setRecordingState('idle');
          setRecordingSeconds(0);
          autoSubmitRef.current = false;
        }
      };

      recorder.start(250);
      setRecordingState('recording');
      setRecordingSeconds(0);

      const startTime = Date.now();
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingSeconds(elapsed);
        if (elapsed >= 60) {
          stopRecording();
        }
      }, 500);
    } catch (err: any) {
      console.warn('[ShopfloorAgent] MediaRecorder error:', err);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setComposerError('Microphone blocked. Allow microphone access in the browser address bar, then try again.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleToggleVoice = () => {
    if (recordingState === 'recording') {
      stopRecording();
    } else if (recordingState === 'idle') {
      startRecording();
    }
  };

  const handleMicMouseDown = () => {
    if (recordingState === 'transcribing') return;
    isLongPressRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      autoSubmitRef.current = true;
      if (recordingState === 'idle') {
        startRecording();
      }
    }, 350);
  };

  const handleMicMouseUp = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      stopRecording();
    }
  };

  const handleMicClick = () => {
    if (recordingState === 'transcribing') return;
    autoSubmitRef.current = false;
    handleToggleVoice();
  };

  useEffect(() => {
    if (initialCamera) {
      handleStartCamera();
    }
  }, [initialCamera]);

  const handleSendMessage = async (textToSend?: string) => {
    const queryText = (textToSend || inputText).trim();
    const queryImage = attachedImage;
    const queryFile = attachedFile;

    if (!queryText && !queryImage && !queryFile) return;

    let targetChatId = activeChatId;
    if (!targetChatId) {
      if (user?.uid) {
        try {
          const docRef = await addDoc(collection(db, 'users', user.uid, 'chats'), {
            title: queryText.slice(0, 32) || (queryFile ? queryFile.name.slice(0, 32) : 'Camera Alarm Diagnostic'),
            controller: activeController,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isPinned: false,
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
      text: queryText || (queryFile ? `Uploaded document: ${queryFile.name}` : 'Pendant Snapshot'),
      imageUrl: queryImage,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), tempUserMsg]);
    setInputText('');
    setAttachedImage(null);
    setAttachedFile(null);
    setIsSending(true);

    try {
      const response = await apiFetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: queryText,
          image: queryImage,
          fileData: queryFile ? { name: queryFile.name, type: queryFile.type, base64: queryFile.base64 } : null,
          controller: activeController,
          language: selectedLanguage,
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
          intent: data.intent || null,
          diagnosis: data.diagnosis || null,
          citations: data.citations || null,
          toolCalls: data.toolCalls || null,
          createdAt: new Date().toISOString(),
          confidence: data.confidence ?? null,
          faultType: data.faultType ?? null,
          reasoning: data.reasoning || null,
        };
        setMessages((prev) => [...(Array.isArray(prev) ? prev : []), assistantMsg]);
      }
    } catch (err: any) {
      console.error('[ShopfloorAgent] Send error:', err);
      const fallbackMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        text: err?.message || 'CNC Copilot is temporarily experiencing high load. Please retry in a moment.',
        createdAt: new Date().toISOString(),
        confidence: null,
        faultType: 'AI Unavailable',
        isError: true,
        failedQuery: queryText,
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

  const handlePlayAnswer = async (msg: ChatMessage) => {
    if (playingMessageId === msg.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingMessageId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setPlayingMessageId(msg.id);

    try {
      const res = await apiFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msg.id,
          text: msg.text,
          language: selectedLanguage,
        }),
      });

      if (!res.ok) {
        throw new Error(`TTS failed with status ${res.status}`);
      }

      const data = await res.json();
      if (!data.audioUrl) {
        throw new Error('No audio URL returned');
      }

      const audio = new Audio(data.audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setPlayingMessageId((current) => (current === msg.id ? null : current));
        audioRef.current = null;
      };

      audio.onerror = () => {
        setPlayingMessageId((current) => (current === msg.id ? null : current));
        audioRef.current = null;
      };

      await audio.play();
    } catch (err: any) {
      console.error(JSON.stringify({ action: 'playAnswer', error: err?.message || String(err) }));
      setPlayingMessageId(null);
    }
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
                      <div className="flex items-center gap-1 min-w-0">
                        {chat.isPinned && (
                          <span className="material-symbols-outlined text-[13px] text-secondary flex-shrink-0" title="Pinned chat">
                            push_pin
                          </span>
                        )}
                        <span className={`font-headline-sm text-body-md ${activeChatId === chat.id ? 'text-on-surface font-semibold' : 'text-tertiary group-hover:text-on-surface'} line-clamp-1 transition-colors`}>
                          {chat.title}
                        </span>
                      </div>
                      <Badge variant={activeChatId === chat.id ? 'primary' : 'tertiary'}>
                        {chat.controller.split(' ')[0]}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-tertiary font-label-sm text-label-sm font-mono">
                      <span>{getRelativeTime(chat.updatedAt)}</span>
                      <div className="flex items-center gap-1.5">
                        {activeChatId === chat.id && (
                          <span className="text-secondary flex items-center gap-1 font-semibold text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>ACTIVE
                          </span>
                        )}

                        {/* 3-Dot Dropdown Menu */}
                        <div className="relative">
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenChatId(menuOpenChatId === chat.id ? null : chat.id);
                            }}
                            className="p-1 rounded text-tertiary hover:text-on-surface hover:bg-surface-container-high transition-colors"
                            title="Chat options"
                          >
                            <span className="material-symbols-outlined text-[16px]">more_vert</span>
                          </button>

                          {menuOpenChatId === chat.id && (
                            <div 
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-1 w-36 rounded-lg bg-surface-container-high border border-outline-variant shadow-2xl py-1 z-40 text-xs font-mono"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  handleTogglePinChat(chat);
                                  setMenuOpenChatId(null);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-surface-container flex items-center gap-2 text-on-surface transition-colors"
                              >
                                <span className="material-symbols-outlined text-[15px] text-secondary">
                                  {chat.isPinned ? 'keep_off' : 'push_pin'}
                                </span>
                                <span>{chat.isPinned ? 'Unpin Chat' : 'Pin Chat'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  handleExportChat(chat);
                                  setMenuOpenChatId(null);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-surface-container flex items-center gap-2 text-on-surface transition-colors"
                              >
                                <span className="material-symbols-outlined text-[15px] text-primary">download</span>
                                <span>Export Chat</span>
                              </button>

                              <div className="border-t border-surface-container my-1"></div>

                              <button
                                type="button"
                                onClick={() => {
                                  setChatToDelete(chat);
                                  setMenuOpenChatId(null);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-error-container/20 flex items-center gap-2 text-error transition-colors"
                              >
                                <span className="material-symbols-outlined text-[15px]">delete</span>
                                <span>Delete Chat</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
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
              </div>
              <div className="flex items-center gap-2">
                <ButtonSecondary onClick={() => handleExportChat(activeChat, messages)} icon="picture_as_pdf" className="h-9 px-3">
                  <span className="hidden md:inline">Export</span>
                </ButtonSecondary>
                <IconButton 
                  icon="delete_sweep" 
                  onClick={() => {
                    const target = activeChat || chats.find((c) => c.id === activeChatId) || (activeChatId ? { id: activeChatId, title: 'Current Diagnostic Session', controller: activeController } : null);
                    if (target) {
                      setChatToDelete(target);
                    } else {
                      setMessages([]);
                    }
                  }} 
                  title="Delete Conversation" 
                  className="w-9 h-9 min-w-0 min-h-0" 
                />
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
                        <>
                          {msg.citations && msg.citations.length > 0 && (
                            <Badge variant="secondary">
                              {msg.citations.length} SOURCES
                            </Badge>
                          )}
                          {playingMessageId === msg.id ? (
                            <div className="w-7 h-7 rounded bg-surface-container flex items-center justify-center p-0.5 shadow-sm animate-pulse" title="Playing answer">
                              <div className="w-4 h-4 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
                            </div>
                          ) : (
                            <IconButton
                              icon="volume_up"
                              title="Play answer"
                              onClick={() => handlePlayAnswer(msg)}
                              className="w-9 h-9 min-w-0 min-h-0"
                            />
                          )}
                        </>
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
                              <img src={(msg.imageUrl && signedImageUrls[msg.imageUrl]) || msg.imageUrl} alt="Pendant Snapshot" className="w-full h-full object-cover opacity-60 grayscale hover:opacity-100 transition-all duration-300" />
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
                      (() => {
                        const isDiagnosis = msg.intent === 'diagnosis' || Boolean(msg.diagnosis) || Boolean(msg.isError);
                        if (!isDiagnosis) {
                          return (
                            <div className="bg-surface-container-low text-on-surface p-4 rounded-2xl rounded-tl-none text-body-md shadow-md max-w-2xl space-y-3">
                              <div className="leading-relaxed prose prose-invert prose-sm max-w-none">
                                <Markdown>{msg.text}</Markdown>
                              </div>

                              {msg.citations && msg.citations.length > 0 && (
                                <div className="pt-2 flex flex-wrap items-center gap-2">
                                  <span className="text-tertiary-container font-label-sm text-label-sm uppercase font-mono mr-1">Verified Citations:</span>
                                  {msg.citations.map((c, i) => {
                                    const pageAnchor = c.pageNumber ? `#page=${c.pageNumber}` : '';
                                    const citationHref = c.fileUrl
                                      ? (c.fileUrl.includes('#page=') ? c.fileUrl : `${c.fileUrl}${pageAnchor}`)
                                      : `/api/kb/file/${encodeURIComponent(c.docId || c.documentName)}${pageAnchor}`;
                                    return (
                                      <a
                                        key={i}
                                        href={citationHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-secondary-container/10 hover:bg-secondary-container/20 text-secondary font-label-sm text-label-sm font-mono transition-colors"
                                        title={c.pageNumber ? `Open manual at page ${c.pageNumber} in new tab` : 'Open manual file in new tab'}
                                      >
                                        <span className="material-symbols-outlined text-[14px]">menu_book</span>
                                        <span>{c.documentName}{c.pageNumber ? ` p.${c.pageNumber}` : ''}</span>
                                        <span className="material-symbols-outlined text-[12px] opacity-70">open_in_new</span>
                                      </a>
                                    );
                                  })}
                                </div>
                              )}

                              {msg.toolCalls && msg.toolCalls.length > 0 && (
                                <details className="group bg-surface-container-lowest rounded-lg p-3 transition-all [&_summary::-webkit-details-marker]:hidden">
                                  <summary className="flex items-center justify-between cursor-pointer select-none text-tertiary hover:text-on-surface">
                                    <div className="flex items-center gap-2 font-label-sm text-label-sm font-mono uppercase text-secondary">
                                      <span className="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">terminal</span>
                                      <span>Diagnostic Reasoning Chain ({msg.toolCalls.length})</span>
                                    </div>
                                    <span className="material-symbols-outlined text-[16px] group-open:rotate-180 transition-transform">expand_more</span>
                                  </summary>
                                  <div className="mt-3 pt-3 border-t border-surface-container font-mono text-body-sm text-tertiary space-y-2 leading-relaxed">
                                    {msg.toolCalls.map((tc, idx) => (
                                      <div key={idx} className="p-2 rounded bg-surface-container text-secondary text-label-sm">
                                        <div className="font-bold text-on-surface flex items-center gap-1.5">
                                          <span className="material-symbols-outlined text-[14px]">functions</span>
                                          <span>{tc.name}</span>
                                        </div>
                                        <div className="mt-1 text-[11px] text-tertiary font-mono">
                                          <strong>Args:</strong> {JSON.stringify(tc.args)}
                                        </div>
                                        <div className="mt-1 text-[11px] text-on-surface font-mono">
                                          <strong>Result:</strong> {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div className="w-full bg-surface-container-low p-5 sm:p-6 rounded-2xl rounded-tl-none space-y-4 shadow-xl">
                            {/* Diagnostic Resolution Header & Content */}
                            <div className="bg-surface-container p-3.5 rounded-lg flex flex-col md:flex-row md:items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1">
                                <span className="material-symbols-outlined text-primary text-[28px] mt-0.5">error_outline</span>
                                <div className="space-y-3 flex-1">
                                  <div>
                                    <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                                      {msg.isError ? 'Diagnostic Interlock' : 'Diagnostic Resolution'}
                                    </h4>
                                    {msg.diagnosis?.alarmCode && (
                                      <div className="font-mono text-body-sm font-bold text-secondary mt-0.5">
                                        {msg.diagnosis.alarmCode}{msg.diagnosis.alarmText ? `: ${msg.diagnosis.alarmText}` : ''}
                                      </div>
                                    )}
                                  </div>

                                  {msg.diagnosis?.safetyNote && (
                                    <div className="p-2.5 rounded bg-error-container/20 border border-error/30 text-error text-body-sm flex items-start gap-2">
                                      <span className="material-symbols-outlined text-[18px] flex-shrink-0">warning</span>
                                      <span>{msg.diagnosis.safetyNote}</span>
                                    </div>
                                  )}

                                  {msg.diagnosis?.likelyCauses && msg.diagnosis.likelyCauses.length > 0 && (
                                    <div className="space-y-1 font-body-sm text-body-sm">
                                      <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary">Likely Causes:</span>
                                      <ul className="list-disc list-inside space-y-1 text-tertiary">
                                        {msg.diagnosis.likelyCauses.map((cause, idx) => (
                                          <li key={idx}>{cause}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {msg.diagnosis?.steps && msg.diagnosis.steps.length > 0 && (
                                    <div className="space-y-1 font-body-sm text-body-sm">
                                      <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary">Resolution Steps:</span>
                                      <ol className="list-decimal list-inside space-y-1 text-tertiary">
                                        {msg.diagnosis.steps.map((step, idx) => (
                                          <li key={idx}>{step}</li>
                                        ))}
                                      </ol>
                                    </div>
                                  )}

                                  {!msg.diagnosis && (
                                    <div className="font-body-sm text-body-sm text-tertiary mt-0.5 prose prose-invert prose-xs">
                                      <Markdown>{msg.text}</Markdown>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {msg.isError && (
                                <div className="flex items-center gap-3 self-start flex-shrink-0">
                                  <ButtonSecondary onClick={() => handleSendMessage(msg.failedQuery)} icon="refresh" className="h-9 px-3">
                                    Retry
                                  </ButtonSecondary>
                                </div>
                              )}
                            </div>

                            {/* Citations */}
                            {msg.citations && msg.citations.length > 0 && (
                              <div className="pt-2 flex flex-wrap items-center gap-2">
                                <span className="text-tertiary-container font-label-sm text-label-sm uppercase font-mono mr-1">Verified Citations:</span>
                                {msg.citations.map((c, i) => {
                                  const pageAnchor = c.pageNumber ? `#page=${c.pageNumber}` : '';
                                  const citationHref = c.fileUrl
                                    ? (c.fileUrl.includes('#page=') ? c.fileUrl : `${c.fileUrl}${pageAnchor}`)
                                    : `/api/kb/file/${encodeURIComponent(c.docId || c.documentName)}${pageAnchor}`;
                                  return (
                                    <a
                                      key={i}
                                      href={citationHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-secondary-container/10 hover:bg-secondary-container/20 text-secondary font-label-sm text-label-sm font-mono transition-colors"
                                      title={c.pageNumber ? `Open manual at page ${c.pageNumber} in new tab` : 'Open manual file in new tab'}
                                    >
                                      <span className="material-symbols-outlined text-[14px]">menu_book</span>
                                      <span>{c.documentName}{c.pageNumber ? ` p.${c.pageNumber}` : ''}</span>
                                      <span className="material-symbols-outlined text-[12px] opacity-70">open_in_new</span>
                                    </a>
                                  );
                                })}
                              </div>
                            )}

                            {/* Diagnostic Reasoning Chain - ONLY when toolCalls is non-empty */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <details className="group bg-surface-container-lowest rounded-lg p-3 transition-all [&_summary::-webkit-details-marker]:hidden">
                                <summary className="flex items-center justify-between cursor-pointer select-none text-tertiary hover:text-on-surface">
                                  <div className="flex items-center gap-2 font-label-sm text-label-sm font-mono uppercase text-secondary">
                                    <span className="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">terminal</span>
                                    <span>Diagnostic Reasoning Chain ({msg.toolCalls.length})</span>
                                  </div>
                                  <span className="material-symbols-outlined text-[16px] group-open:rotate-180 transition-transform">expand_more</span>
                                </summary>
                                <div className="mt-3 pt-3 border-t border-surface-container font-mono text-body-sm text-tertiary space-y-2 leading-relaxed">
                                  {msg.toolCalls.map((tc, idx) => (
                                    <div key={idx} className="p-2 rounded bg-surface-container text-secondary text-label-sm">
                                      <div className="font-bold text-on-surface flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[14px]">functions</span>
                                        <span>{tc.name}</span>
                                      </div>
                                      <div className="mt-1 text-[11px] text-tertiary font-mono">
                                        <strong>Args:</strong> {JSON.stringify(tc.args)}
                                      </div>
                                      <div className="mt-1 text-[11px] text-on-surface font-mono">
                                        <strong>Result:</strong> {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        );
                      })()
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
                
                {attachedImage && (
                  <div className="flex items-center gap-2 p-1.5 pl-2 pr-1 rounded-lg bg-surface-container border border-outline-variant/30 w-fit">
                    <img src={attachedImage} alt="Attachment thumbnail" className="w-10 h-10 object-cover rounded" />
                    <span className="font-mono text-label-sm text-tertiary">Image attached</span>
                    <IconButton
                      icon="close"
                      title="Remove image"
                      onClick={() => setAttachedImage(null)}
                      className="w-7 h-7 min-w-0 min-h-0 text-tertiary hover:text-error"
                    />
                  </div>
                )}
                {attachedFile && (
                  <div className="flex items-center gap-2 p-1.5 pl-2 pr-1 rounded-lg bg-surface-container border border-outline-variant/30 w-fit">
                    <span className="material-symbols-outlined text-primary text-[20px]">
                      {attachedFile.type === 'application/pdf' ? 'picture_as_pdf' : 'description'}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-mono text-label-sm text-on-surface truncate max-w-[200px]">
                        {attachedFile.name}
                      </span>
                      <span className="text-[10px] text-tertiary font-mono">
                        {(attachedFile.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                    <IconButton
                      icon="close"
                      title="Remove file"
                      onClick={() => setAttachedFile(null)}
                      className="w-7 h-7 min-w-0 min-h-0 text-tertiary hover:text-error"
                    />
                  </div>
                )}
                {composerError && (
                  <div className="p-2.5 rounded bg-error-container/20 border border-error/30 text-error text-body-sm flex items-center justify-between gap-2">
                    <span>{composerError}</span>
                    <IconButton
                      icon="close"
                      title="Dismiss error"
                      onClick={() => setComposerError(null)}
                      className="w-6 h-6 min-w-0 min-h-0 text-error"
                    />
                  </div>
                )}

                {/* Input Toolbar */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1 sm:gap-2">
                    {/* Camera */}
                    <button 
                      onClick={handleStartCamera}
                      className={`h-10 w-10 sm:h-11 sm:w-11 rounded-lg ${attachedImage ? 'bg-primary/20 text-primary' : 'bg-surface-container text-tertiary'} hover:bg-surface-container-high hover:text-on-surface flex items-center justify-center transition-colors relative`} 
                      title="Capture / Upload Photo" 
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">photo_camera</span>
                      {attachedImage && <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary"></div>}
                    </button>
                    <input ref={cameraFallbackInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCameraFallbackSelect} />

                    {/* Push to Talk Mic: Click to toggle or Hold to speak */}
                    <button 
                      onClick={handleMicClick}
                      onMouseDown={handleMicMouseDown}
                      onMouseUp={handleMicMouseUp}
                      onTouchStart={handleMicMouseDown}
                      onTouchEnd={handleMicMouseUp}
                      disabled={recordingState === 'transcribing'}
                      className={`h-10 px-3 sm:px-4 rounded-lg bg-surface-container hover:bg-surface-container-high ${recordingState === 'recording' ? 'text-error ring-1 ring-error/50' : 'text-primary'} flex items-center gap-2 transition-all group relative overflow-hidden select-none cursor-pointer`} 
                      title="Click to toggle or Press & Hold to speak" 
                      type="button"
                    >
                      <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${recordingState === 'recording' ? 'bg-error' : 'bg-primary'} opacity-75`}></span>
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${recordingState === 'recording' ? 'bg-error' : 'bg-primary'}`}></span>
                      </span>
                      <span className="material-symbols-outlined text-[20px]">{recordingState === 'recording' ? 'mic' : 'mic_none'}</span>
                      <span className="font-label-sm text-label-sm font-mono uppercase tracking-tight hidden sm:inline">
                        {recordingState === 'recording'
                          ? `LISTENING 0:${recordingSeconds < 10 ? '0' : ''}${recordingSeconds}`
                          : recordingState === 'transcribing'
                          ? 'TRANSCRIBING...'
                          : 'VOICE AGENT'}
                      </span>
                    </button>

                    {/* Attachment Paperclip */}
                    <button
                      onClick={() => attachmentInputRef.current?.click()}
                      className={`h-10 w-10 sm:h-11 sm:w-11 rounded-lg ${attachedFile ? 'bg-primary/20 text-primary' : 'bg-surface-container text-tertiary'} hover:bg-surface-container-high hover:text-on-surface flex items-center justify-center transition-colors relative`}
                      title="Attach photo or document (PDF)"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                      {attachedFile && <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary"></div>}
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
                      className="hidden"
                      onChange={handleAttachmentSelect}
                    />

                    {/* Language Preference Dropdown Button */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setLangMenuOpen(!langMenuOpen)}
                        className="h-10 px-2 sm:px-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-tertiary hover:text-on-surface flex items-center gap-1 transition-colors border border-outline-variant/30"
                        title="Language Preference"
                      >
                        <span className="material-symbols-outlined text-[18px]">translate</span>
                        <span className="font-mono text-xs font-bold text-on-surface uppercase">
                          {LANGUAGES.find((l) => l.code === selectedLanguage)?.short || 'EN'}
                        </span>
                      </button>

                      {langMenuOpen && (
                        <div className="absolute bottom-full mb-2 left-0 w-44 rounded-xl bg-surface-container-high border border-outline-variant shadow-2xl py-1 z-50">
                          <div className="px-3 py-1.5 border-b border-surface-container text-[10px] font-mono uppercase text-tertiary tracking-wider">
                            Language Preference
                          </div>
                          {LANGUAGES.map((l) => (
                            <button
                              key={l.code}
                              type="button"
                              onClick={() => {
                                setSelectedLanguage(l.code);
                                setLangMenuOpen(false);
                                if (user) {
                                  updatePreferences({ preferredLanguage: l.code });
                                }
                              }}
                              className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center justify-between hover:bg-surface-container transition-colors ${
                                selectedLanguage === l.code
                                  ? 'text-secondary font-bold bg-secondary/10'
                                  : 'text-on-surface'
                              }`}
                            >
                              <span>{l.label}</span>
                              {selectedLanguage === l.code && (
                                <span className="material-symbols-outlined text-[14px]">check</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Send Action Button */}
                  <IconButton 
                    icon="arrow_upward"
                    onClick={() => handleSendMessage()}
                    disabled={isSending || (!inputText.trim() && !attachedImage && !attachedFile)}
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
              </div>
            </footer>
          </section>
        </div>
      </div>

      {/* Pendant Camera Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <GlassPanel className="w-full max-w-xl p-6 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-surface-container pb-3">
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">photo_camera</span>
                <span>Pendant Camera</span>
              </h3>
              <IconButton icon="close" title="Close" onClick={handleCloseCamera} className="w-8 h-8 min-w-0 min-h-0" />
            </div>

            {cameraError ? (
              <div className="flex flex-col gap-4 py-4">
                <div className="p-3 rounded bg-error-container/20 border border-error/30 text-error text-body-sm flex items-start gap-2">
                  <span className="material-symbols-outlined text-[18px] flex-shrink-0">error</span>
                  <span>{cameraError}</span>
                </div>
                <div className="flex justify-end">
                  <ButtonSecondary onClick={handleCloseCamera}>Cancel</ButtonSecondary>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="w-full bg-black rounded-lg overflow-hidden flex items-center justify-center min-h-[260px] max-h-[50vh] relative">
                  {capturedFrame ? (
                    <img src={capturedFrame} alt="Captured preview" className="w-full h-full object-contain" />
                  ) : (
                    <video
                      ref={videoRef}
                      playsInline
                      autoPlay
                      muted
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  {!capturedFrame ? (
                    <>
                      <ButtonSecondary onClick={handleCloseCamera}>Cancel</ButtonSecondary>
                      <ButtonPrimary onClick={handleCapturePhoto} icon="camera">Capture</ButtonPrimary>
                    </>
                  ) : (
                    <>
                      <ButtonSecondary onClick={handleRetakePhoto} icon="refresh">Retake</ButtonSecondary>
                      <ButtonPrimary onClick={handleUsePhoto} icon="check">Use photo</ButtonPrimary>
                      <ButtonSecondary onClick={handleCloseCamera}>Cancel</ButtonSecondary>
                    </>
                  )}
                </div>
              </div>
            )}
          </GlassPanel>
        </div>
      )}

      {/* Citation Inspection Drawer */}
      <Drawer
        isOpen={Boolean(selectedCitation)}
        onClose={() => setSelectedCitation(null)}
        title="Verified OEM Manual Citation"
      >
        {selectedCitation && (
          <div className="space-y-4 font-mono">
            <div>
              <span className="text-tertiary-container font-label-sm text-label-sm uppercase tracking-wider block mb-1">Document</span>
              <h3 className="font-headline-sm text-on-surface font-bold text-base flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[18px]">menu_book</span>
                {selectedCitation.documentName}
              </h3>
            </div>
            {selectedCitation.pageNumber ? (
              <div>
                <span className="text-tertiary-container font-label-sm text-label-sm uppercase tracking-wider block mb-1">Page Reference</span>
                <span className="inline-block px-2 py-0.5 rounded bg-surface-container text-secondary text-xs font-bold">
                  Page {selectedCitation.pageNumber}
                </span>
              </div>
            ) : null}
            <div>
              <span className="text-tertiary-container font-label-sm text-label-sm uppercase tracking-wider block mb-1">Retrieved Passage / Snippet</span>
              <div className="p-3 bg-surface-container rounded-lg text-xs text-on-surface leading-relaxed whitespace-pre-wrap border border-outline-variant/20">
                {selectedCitation.snippet}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* Delete Chat Confirmation Modal */}
      {chatToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-surface-container border border-outline-variant shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3 text-error">
              <span className="material-symbols-outlined text-[28px]">warning</span>
              <h3 className="font-headline-sm text-base font-bold text-on-surface">
                Delete Diagnostic Session?
              </h3>
            </div>
            <p className="text-body-sm text-tertiary">
              Are you sure you want to permanently delete <strong className="text-on-surface font-mono">"{chatToDelete.title}"</strong>? All conversation logs and diagnostic telemetry will be removed. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <ButtonSecondary onClick={() => setChatToDelete(null)}>Cancel</ButtonSecondary>
              <button
                type="button"
                onClick={() => handleConfirmDelete(chatToDelete.id)}
                className="h-10 px-4 rounded-lg bg-error text-on-error font-mono text-xs font-bold hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                <span>Delete Permanently</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
