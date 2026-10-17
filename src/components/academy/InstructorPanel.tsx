import React, { useState } from 'react';
import { GlassPanel } from '../ui/Layout.js';
import { Badge } from '../ui/Badge.js';
import { IconButton } from '../ui/Button.js';
import { apiFetch } from '../../lib/firebase.js';
import { useAuth } from '../../context/AuthContext.js';
import { CollisionEvent } from '../../engine/crash.js';

interface Message {
  role: 'instructor' | 'user';
  text: string;
}

interface InstructorPanelProps {
  missionId: string;
  sessionId?: string;
  hintsRevealed: number;
  onRevealHint: () => void;
  xpPenalty: number;
  program?: string;
  crashEvent?: CollisionEvent | null;
}

export function InstructorPanel({
  missionId,
  sessionId,
  hintsRevealed,
  onRevealHint,
  xpPenalty,
  program,
  crashEvent,
}: InstructorPanelProps) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'instructor',
      text: "Welcome to the Crash Lab. I'm here to ensure you learn from failure. Analyze the program, identify the kinematic risk, and correct the G-code.",
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const userMsg: Message = { role: 'user', text: inputText };
    setMessages((prev) => [...prev, userMsg]);
    const textToSend = inputText;
    setInputText('');
    setIsSending(true);

    try {
      const res = await apiFetch('/api/instructor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId,
          program,
          crashEvent,
          hintLevel: Math.max(1, Math.min(3, hintsRevealed || 1)),
          language: profile?.preferredLanguage || 'en',
          question: textToSend,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: 'instructor', text: data.reply }]);
      } else {
        setMessages((prev) => [...prev, { role: 'instructor', text: 'Instructor is currently unavailable. Please retry.' }]);
      }
    } catch (err) {
      console.warn('[Instructor] Chat error:', err);
      setMessages((prev) => [...prev, { role: 'instructor', text: 'Instructor is currently unavailable. Please retry.' }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleRevealHintClick = async () => {
    const nextLevel = Math.min(3, hintsRevealed + 1);
    onRevealHint();
    setIsSending(true);

    if (sessionId) {
      apiFetch('/api/academy/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          missionId,
          type: 'hint',
          detail: { hintLevel: nextLevel },
        }),
      }).catch((err) => console.warn('[Instructor] Event hint warn:', err));
    }

    try {
      const res = await apiFetch('/api/instructor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId,
          program,
          crashEvent,
          hintLevel: nextLevel,
          language: profile?.preferredLanguage || 'en',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: 'instructor', text: data.reply }]);
      }
    } catch (err) {
      console.warn('[Instructor] Hint fetch error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setInputText(transcript);
    };
    recognition.start();
  };

  const quickQuestions = [
    'Why did it crash?',
    'What does this code do?',
    'How do I check this on a real machine?',
  ];

  return (
    <GlassPanel className="h-full flex flex-col overflow-hidden">
      {/* Instructor Header */}
      <div className="p-4 border-b border-outline-variant/30 flex items-center gap-3 bg-surface-container-low/50">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-primary-container/20 border border-primary-container/40 flex items-center justify-center text-primary-container">
            <span className="material-symbols-outlined text-[28px]">smart_toy</span>
          </div>
          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-secondary border-2 border-surface-container shadow-sm"></span>
        </div>
        <div className="flex-1">
          <h3 className="font-headline-sm text-sm font-bold text-on-surface">Copilot Instructor</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-secondary uppercase font-bold tracking-wider">Gemini instructor</span>
          </div>
        </div>
      </div>

      {/* Chat Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-surface-container-high">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <span className="font-mono text-[9px] text-tertiary-container uppercase mb-1">
              {m.role === 'instructor' ? 'Copilot' : 'Operator'}
            </span>
            <div
              className={`max-w-[90%] p-3 rounded-xl text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-primary-container/10 text-on-surface rounded-tr-none border border-primary-container/20'
                  : 'bg-surface-container-high text-tertiary rounded-tl-none border border-outline-variant/30'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex gap-1 items-center text-secondary font-mono text-[10px] uppercase">
            <span className="animate-bounce">.</span>
            <span className="animate-bounce [animation-delay:0.2s]">.</span>
            <span className="animate-bounce [animation-delay:0.4s]">.</span>
            Processing Kinematics
          </div>
        )}
      </div>

      {/* Hint Tier System */}
      <div className="p-4 border-t border-outline-variant/20 bg-surface-container-low/30 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono font-bold text-tertiary uppercase tracking-widest flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">lightbulb</span>
            Hint Tier System
          </span>
          <span className="text-[10px] font-mono text-tertiary-container">{hintsRevealed}/3 Unlocked</span>
        </div>

        <div className="space-y-2">
          {hintsRevealed < 3 && (
            <button
              onClick={handleRevealHintClick}
              className="w-full h-10 px-4 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 text-xs font-bold text-on-surface flex items-center justify-between transition-all group"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">lock</span>
                <span>Reveal Hint {hintsRevealed + 1}</span>
              </div>
              <Badge variant="error">-{xpPenalty}% XP</Badge>
            </button>
          )}
          {hintsRevealed > 0 && (
            <div className="p-3 rounded-lg bg-primary-container/5 border border-primary-container/20 text-[11px] text-tertiary italic">
              "Hint logic is being streamed from the process engine..."
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-surface-container-low border-t border-outline-variant/30">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {quickQuestions.map((q) => (
            <button
              key={q}
              onClick={() => setInputText(q)}
              className="px-2 py-1 rounded bg-surface-container border border-outline-variant/30 text-[10px] text-tertiary hover:text-on-surface hover:border-secondary transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask the instructor..."
              className="w-full h-10 pl-3 pr-10 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-secondary transition-all"
            />
            <button
              onClick={handleSendMessage}
              disabled={isSending || !inputText.trim()}
              className="absolute right-1 top-1 w-8 h-8 rounded-md flex items-center justify-center text-secondary hover:bg-secondary/10 disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-[20px]">send</span>
            </button>
          </div>
          <IconButton
            icon="mic"
            title="Voice Input"
            onClick={handleVoiceInput}
            className="w-10 h-10 min-w-0 min-h-0 bg-surface-container"
          />
        </div>
      </div>
    </GlassPanel>
  );
}
