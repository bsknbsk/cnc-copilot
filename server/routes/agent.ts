import { Router, Request, Response } from 'express';
import multer from 'multer';
import { adminDb, adminStorage } from '../firebase.js';
import { MODEL_FLASH } from '../config.js';
import { getGemini, executeWithRetry, getFriendlyErrorMessage } from '../geminiClient.js';
import { Type, FunctionDeclaration } from '@google/genai';
import { logAIRequest } from '../logger.js';
import { requireAuth } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';
import { calculateCutting } from '../../src/engine/cutting.js';
import { MATERIALS, MaterialSpec } from '../../src/engine/materials.js';
import { parseAndVerifyGCode } from '../../src/engine/gcode.js';

export const agentRouter = Router();

let cachedFileSearchStoreName: string | null = null;
async function getFileSearchStoreName(): Promise<string | null> {
  if (cachedFileSearchStoreName) return cachedFileSearchStoreName;
  try {
    const doc = await adminDb.collection('config').doc('app').get();
    if (doc.exists && doc.data()?.fileSearchStoreName) {
      cachedFileSearchStoreName = doc.data()!.fileSearchStoreName;
      return cachedFileSearchStoreName;
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', route: 'getFileSearchStoreName', error: err?.message || String(err) }));
  }
  return null;
}

function resolveMaterial(matInput: string): MaterialSpec {
  const norm = (matInput || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (MATERIALS[norm]) return MATERIALS[norm];
  for (const [key, spec] of Object.entries(MATERIALS)) {
    const keyNorm = key.toLowerCase();
    const nameNorm = spec.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (keyNorm.includes(norm) || norm.includes(keyNorm) || nameNorm.includes(norm)) {
      return spec;
    }
  }
  if (norm.includes('6061') || norm.includes('alum')) return MATERIALS.al6061;
  if (norm.includes('1045') || norm.includes('carbon')) return MATERIALS.steel1045;
  if (norm.includes('304') || norm.includes('stainless')) return MATERIALS.ss304;
  if (norm.includes('ti') || norm.includes('titanium')) return MATERIALS.ti6al4v;
  if (norm.includes('inconel') || norm.includes('718')) return MATERIALS.inconel718;
  if (norm.includes('cast') || norm.includes('iron') || norm.includes('gg25')) return MATERIALS.castiron;
  if (norm.includes('brass') || norm.includes('c36000')) return MATERIALS.brass;
  return MATERIALS.al6061;
}

function executeCalculateCutting(args: any) {
  const matSpec = resolveMaterial(args.material || '6061');
  const toolMat = (args.toolMaterial?.toLowerCase() === 'hss' ? 'hss' : 'carbide') as 'carbide' | 'hss';
  const process = (args.process?.toLowerCase() || 'milling') as any;
  const diameter = Number(args.diameter) || 10;
  const flutes = Number(args.flutes) || (process === 'milling' ? 4 : 1);
  const vc = Number(args.vc) || ((matSpec[toolMat].vc.min + matSpec[toolMat].vc.max) / 2);
  const feed = Number(args.feed) || ((matSpec[toolMat].fz.min + matSpec[toolMat].fz.max) / 2);
  const ap = args.ap !== undefined ? Number(args.ap) : (process === 'milling' ? diameter : undefined);
  const ae = args.ae !== undefined ? Number(args.ae) : (process === 'milling' ? diameter * 0.4 : undefined);
  const machineMaxKw = Number(args.machineMaxKw) || 15;

  const result = calculateCutting({
    process,
    material: matSpec,
    toolMaterial: toolMat,
    diameter,
    flutes,
    vc,
    feed,
    ap,
    ae,
    machineMaxKw,
  });

  return {
    materialName: matSpec.name,
    isoGroup: matSpec.isoGroup,
    toolMaterial: toolMat,
    diameterMm: diameter,
    flutes,
    vcMPerMin: vc,
    feedMmPerToothOrRev: feed,
    rpm: result.rpm,
    feedRateMmPerMin: result.feedRate,
    mrrCm3PerMin: result.mrr,
    powerKw: result.powerKw,
    torqueNm: result.torqueNm,
    powerPercent: result.powerPercent,
    powerZone: result.powerZone,
    chipThicknessMm: result.chipThickness,
    specificForceNPerMm2: result.specificForce,
    tangentialForceN: result.tangentialForce,
    validation: result.validation,
  };
}

function executeGetMaterial(args: any) {
  const matSpec = resolveMaterial(args.material || '6061');
  return {
    id: matSpec.id,
    name: matSpec.name,
    isoGroup: matSpec.isoGroup,
    isoClass: matSpec.isoClass,
    hardness: matSpec.hardness,
    yieldMpa: matSpec.yieldMpa,
    kc1: matSpec.kc1,
    carbide: matSpec.carbide,
    hss: matSpec.hss,
    note: matSpec.note,
  };
}

function executeVerifyGCode(args: any) {
  const parseResult = parseAndVerifyGCode(args.program || '', args.controller || 'fanuc');
  return {
    blockCount: parseResult.blockCount,
    criticalCount: parseResult.criticalCount,
    warningCount: parseResult.warningCount,
    infoCount: parseResult.infoCount,
    findings: parseResult.findings,
  };
}

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'calculate_cutting',
    description: 'Calculates CNC speeds, feeds, MRR, cutting power, torque, and chip thickness using physics formulas.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        process: {
          type: Type.STRING,
          description: 'Machining process: "milling", "turning", "drilling", "tapping", or "boring"',
        },
        material: {
          type: Type.STRING,
          description: 'Material identifier or name, e.g. "al6061", "steel1045", "ss304", "ti6al4v", "inconel718", "castiron", "brass"',
        },
        toolMaterial: {
          type: Type.STRING,
          description: 'Cutting tool material: "carbide" or "hss"',
        },
        diameter: {
          type: Type.NUMBER,
          description: 'Tool diameter in mm',
        },
        flutes: {
          type: Type.INTEGER,
          description: 'Number of flutes / teeth on cutter (default 4 for milling)',
        },
        vc: {
          type: Type.NUMBER,
          description: 'Cutting speed Vc in m/min (optional, uses recommended midpoint if omitted)',
        },
        feed: {
          type: Type.NUMBER,
          description: 'Feed per tooth fz (mm/tooth) for milling, or feed per rev fn (mm/rev) for turning/drilling (optional)',
        },
        ap: {
          type: Type.NUMBER,
          description: 'Axial depth of cut in mm (optional)',
        },
        ae: {
          type: Type.NUMBER,
          description: 'Radial width of cut in mm (optional)',
        },
        machineMaxKw: {
          type: Type.NUMBER,
          description: 'Machine spindle rating in kW (optional, default 15)',
        },
      },
      required: ['process', 'material', 'toolMaterial', 'diameter'],
    },
  },
  {
    name: 'get_material',
    description: 'Looks up cutting material properties, ISO classification, hardness, specific cutting force (kc1), and recommended cutting speeds (Vc) and feeds (fz) for carbide and HSS tooling.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        material: {
          type: Type.STRING,
          description: 'Material name or grade, e.g. "6061", "1045", "304", "Inconel 718", "Cast Iron", "Brass"',
        },
      },
      required: ['material'],
    },
  },
  {
    name: 'verify_gcode',
    description: 'Parses and verifies CNC G-code program blocks for kinematic hazards, missing modal codes, rapid plunge hazards, spindle interlocks, and crash conditions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        program: {
          type: Type.STRING,
          description: 'The G-code program lines to analyze',
        },
        controller: {
          type: Type.STRING,
          description: 'Controller dialect: "fanuc", "mitsubishi", or "generic"',
        },
      },
      required: ['program'],
    },
  },
];

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const agentResponseSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['greeting', 'general', 'diagnosis', 'calculation', 'gcode'],
    },
    answerMarkdown: {
      type: Type.STRING,
    },
    citations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          docId: { type: Type.STRING, nullable: true },
          documentName: { type: Type.STRING },
          pageNumber: { type: Type.INTEGER, nullable: true },
          snippet: { type: Type.STRING },
        },
        required: ['documentName', 'snippet'],
      },
    },
    diagnosis: {
      type: Type.OBJECT,
      properties: {
        alarmCode: {
          type: Type.STRING,
          nullable: true,
        },
        alarmText: {
          type: Type.STRING,
          nullable: true,
        },
        likelyCauses: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        steps: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        safetyNote: {
          type: Type.STRING,
          nullable: true,
        },
      },
    },
  },
  required: ['intent', 'answerMarkdown'],
};

// 1. Diagnostic Chat endpoint
agentRouter.post('/chat', requireAuth, rateLimitAI, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { message, image, imageBase64, fileData, controller = 'Fanuc 0i-MF', language = 'en', chatId } = req.body;
  const rawImage = imageBase64 || image;
  const user = req.user!;

  if (!message && !rawImage && !fileData) {
    res.status(400).json({ error: 'missing_input', message: 'Message, photo, or document is required' });
    return;
  }

  const effectiveChatId = chatId || `chat-${Date.now()}`;
  let storedImageUrl: string | null = null;
  let mimeType = 'image/jpeg';
  let base64Data: string | null = null;

  // Multimodal file/photo validation guardrail
  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  // 1. If fileData present (PDF, text, or image)
  let attachedPdfOrDoc: { mimeType: string; data: string; name?: string } | null = null;
  if (fileData && typeof fileData === 'object' && fileData.base64) {
    const fileMime = (fileData.type || 'application/pdf').toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(fileMime)) {
      res.status(400).json({
        error: 'invalid_multimodal_input',
        message: 'File must be JPG, PNG, WEBP, or PDF under 10 MB.',
      });
      return;
    }
    const fileBuf = Buffer.from(fileData.base64, 'base64');
    if (fileBuf.length > MAX_FILE_SIZE) {
      res.status(400).json({
        error: 'invalid_multimodal_input',
        message: 'File must be JPG, PNG, WEBP, or PDF under 10 MB.',
      });
      return;
    }
    attachedPdfOrDoc = {
      mimeType: fileMime,
      data: fileData.base64,
      name: fileData.name,
    };
  }

  // 2. If image present, upload to Cloud Storage at chats/{uid}/{chatId}/{timestamp}.jpg
  if (rawImage && typeof rawImage === 'string') {
    if (rawImage.includes('base64,')) {
      const mimeMatch = rawImage.match(/^data:([^;]+);base64,/);
      mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      base64Data = rawImage.split('base64,')[1];
    } else if (!rawImage.startsWith('http') && !rawImage.startsWith('chats/')) {
      base64Data = rawImage;
    }

    if (base64Data) {
      if (!ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
        res.status(400).json({
          error: 'invalid_multimodal_input',
          message: 'File must be JPG, PNG, WEBP, or PDF under 10 MB.',
        });
        return;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > MAX_FILE_SIZE) {
        res.status(400).json({
          error: 'invalid_multimodal_input',
          message: 'File must be JPG, PNG, WEBP, or PDF under 10 MB.',
        });
        return;
      }

      try {
        const imageTimestamp = Date.now();
        const storagePath = `chats/${user.uid}/${effectiveChatId}/${imageTimestamp}.jpg`;
        const bucket = adminStorage.bucket();
        const file = bucket.file(storagePath);
        await file.save(buffer, {
          metadata: { contentType: mimeType },
          resumable: false,
        });
        storedImageUrl = storagePath;
      } catch (uploadErr: any) {
        console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/agent/chat:imageUpload', error: uploadErr?.message || String(uploadErr) }));
      }
    } else if (rawImage.startsWith('chats/')) {
      storedImageUrl = rawImage;
    }
  }

  // Query available KB documents from Firestore to ground citations
  const availableDocs: Array<{ id: string; name: string; refCode?: string; pages?: number; controller?: string }> = [];
  try {
    const kbSnap = await adminDb.collection('kb_docs').where('status', '==', 'Ready').get();
    kbSnap.forEach((d) => {
      const data = d.data();
      availableDocs.push({
        id: d.id,
        name: data.name,
        refCode: data.refCode,
        pages: data.pages,
        controller: data.controller,
      });
    });
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/agent/chat:fetchKB', error: err?.message || String(err) }));
  }

  const langNames: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    ml: 'Malayalam',
    ta: 'Tamil',
  };
  const targetLanguageName = langNames[language] || 'English';

  const localizedGuardrails: Record<string, string> = {
    en: 'Not found in your uploaded manuals. Here is general guidance based on standard engineering knowledge:',
    hi: 'आपके अपलोड किए गए मैनुअल में नहीं मिला। मानक इंजीनियरिंग ज्ञान के आधार पर सामान्य मार्गदर्शन यहाँ दिया गया है:',
    ml: 'നിങ്ങൾ അപ്‌ലോഡ് ചെയ്ത മാനുവലുകളിൽ കണ്ടെത്തിയില്ല. സാധാരണ എഞ്ചിനീയറിംഗ് അറിവിനെ അടിസ്ഥാനമാക്കിയുള്ള പൊതു മാർഗ്ഗനിർദ്ദേശം ഇതാ:',
    ta: 'நீங்கள் பதிவேற்றிய கையேடுகளில் கிடைக்கவில்லை. நிலையான பொறியியல் அறிவின் அடிப்படையில் பொதுவான வழிகாட்டுதல் இதோ:',
  };

  const systemInstruction = `You are CNC Copilot, an industrial shopfloor assistant for CNC operators and manufacturing engineers on ${controller} controllers.

LANGUAGE INSTRUCTIONS:
1. Primary language preference selected by the operator: ${targetLanguageName} (${language}).
2. If the user typed their question in a specific language (such as Hindi, Malayalam, Tamil, or English), respond in the language they used to type their question.
3. If the input is in the language corresponding to the selected preference dropdown or if the input language is ambiguous/neutral, reply in ${targetLanguageName} (${language}).
4. Keep standard engineering identifiers, G-codes (e.g., G00, G84), M-codes, alarm numbers (e.g., SV0401, ALM 1004), and parameter numbers in original standard form.

Decide the intent of the operator's message and answer in the matching style:
- greeting or small talk: one or two friendly sentences, then one line offering help with alarms, cutting parameters, G-code or the Crash Lab. No headings, no lists.
- general CNC question: a direct answer in plain markdown, short paragraphs or a short list, under 180 words unless asked for detail.
- alarm or fault (an alarm number, an error text, a controller screen photo, or a described machine fault): a diagnosis.
- cutting parameters, speeds, feeds, power: explain the numbers given by the calculation tool; never invent numbers.
- G-code question: explain the code plainly.

Knowledge Base Manual Grounding:
Uploaded shopfloor manuals available:
${availableDocs.length > 0 ? availableDocs.map(d => `- ID: ${d.id} | "${d.name}" | Controller: ${d.controller || 'Generic'} | Pages: ${d.pages || 1}`).join('\n') : 'No manuals currently uploaded.'}

If your answer retrieves and cites specific passages from any uploaded manual listed above, populate the citations list with the documentName, matching docId, pageNumber (if known), and snippet.
If the requested information is not in the uploaded manuals, return an empty citations array (citations: []).
Never claim you checked manuals, registers, sensors or telemetry unless citations are populated. Never state a confidence score.
When resetting alarms, changing parameters or bypassing interlocks is involved, provide a concise one-line safety note in the response language.`;

  try {
    const ai = getGemini();

    const parts: any[] = [];
    if (base64Data) {
      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
      parts.push({
        text: `The image shows a CNC controller screen. Read out any alarm number, alarm text, mode and axis coordinates, then provide remedies.\n\n${message || 'Analyze the controller screen.'}`,
      });
    } else if (attachedPdfOrDoc) {
      parts.push({
        inlineData: {
          mimeType: attachedPdfOrDoc.mimeType,
          data: attachedPdfOrDoc.data,
        },
      });
      parts.push({
        text: `Attached file: ${attachedPdfOrDoc.name || 'document'}.\n\n${message || 'Analyze the attached document.'}`,
      });
    } else {
      parts.push({ text: message || 'Analyze the machine condition.' });
    }

    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_FLASH,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: agentResponseSchema,
        },
      });
    }, language);

    let intent: 'greeting' | 'general' | 'diagnosis' | 'calculation' | 'gcode' = 'general';
    let answerMarkdown = '';
    const citations: any[] = [];
    let diagnosis: {
      alarmCode: string | null;
      alarmText: string | null;
      likelyCauses: string[];
      steps: string[];
      safetyNote: string | null;
    } | null = null;

    try {
      const rawText = response.text || '';
      const parsed = JSON.parse(rawText);
      intent = parsed.intent || 'general';
      answerMarkdown = parsed.answerMarkdown || rawText;

      if (Array.isArray(parsed.citations) && parsed.citations.length > 0) {
        for (const c of parsed.citations) {
          const matchedDoc = availableDocs.find(
            (d) => d.id === c.docId || d.name.toLowerCase().includes((c.documentName || '').toLowerCase())
          );
          const effectiveDocId = matchedDoc?.id || c.docId || '';
          citations.push({
            docId: effectiveDocId,
            documentName: matchedDoc?.name || c.documentName || 'OEM Manual',
            pageNumber: c.pageNumber || null,
            snippet: c.snippet || '',
            fileUrl: effectiveDocId ? `/api/kb/file/${effectiveDocId}` : null,
          });
        }
      }

      // Honesty & Grounding Rule: If no uploaded manual was cited, prefix response with concise one-line guardrail
      if (citations.length === 0 && (intent === 'diagnosis' || intent === 'general')) {
        const guardrailPrefix = localizedGuardrails[language] || localizedGuardrails.en;
        const enPrefix = localizedGuardrails.en;
        if (!answerMarkdown.toLowerCase().includes('not found in your uploaded manuals') && !answerMarkdown.includes(guardrailPrefix)) {
          answerMarkdown = `${guardrailPrefix}\n\n${answerMarkdown}`;
        }
      }

      if (intent === 'diagnosis' && parsed.diagnosis) {
        diagnosis = {
          alarmCode: parsed.diagnosis.alarmCode ?? null,
          alarmText: parsed.diagnosis.alarmText ?? null,
          likelyCauses: Array.isArray(parsed.diagnosis.likelyCauses) ? parsed.diagnosis.likelyCauses : [],
          steps: Array.isArray(parsed.diagnosis.steps) ? parsed.diagnosis.steps : [],
          safetyNote: parsed.diagnosis.safetyNote ?? null,
        };
      }
    } catch {
      answerMarkdown = response.text || '';
      if (!answerMarkdown.toLowerCase().includes('not found in your uploaded manuals')) {
        answerMarkdown = `Not found in your uploaded manuals. Here is general guidance based on standard engineering knowledge:\n\n${answerMarkdown}`;
      }
    }

    const toolCalls: any[] = [];
    const latencyMs = Date.now() - startTime;

    logAIRequest({
      route: '/api/agent/chat',
      uid: user.uid,
      controller,
      language,
      toolNames: [],
      citationCount: citations.length,
      latencyMs,
      model: MODEL_FLASH,
    });

    // Persist messages to Firestore
    if (chatId) {
      try {
        const userChatsRef = adminDb.collection('users').doc(user.uid).collection('chats').doc(chatId);

        // 1. Add user message
        await userChatsRef.collection('messages').add({
          role: 'user',
          text: (message || 'Pendant Camera Screen Snapshot').slice(0, 20000),
          imageUrl: storedImageUrl,
          createdAt: new Date(startTime).toISOString(),
        });

        // 2. Add assistant message
        await userChatsRef.collection('messages').add({
          role: 'model',
          text: answerMarkdown.slice(0, 20000),
          intent,
          diagnosis: diagnosis || null,
          citations: citations.length > 0 ? citations : null,
          toolCalls: null,
          createdAt: new Date().toISOString(),
        });

        // 3. Update chat session metadata
        await userChatsRef.set({
          title: (message || 'Alarm Diagnostic').slice(0, 48),
          controller,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        // 4. Log to user activity
        await adminDb.collection('users').doc(user.uid).collection('activity').add({
          type: 'chat',
          title: `Diagnostic: ${(message || controller).slice(0, 40)}`.slice(0, 120),
          summary: answerMarkdown.slice(0, 300),
          link: chatId,
          createdAt: new Date().toISOString(),
        });
      } catch (dbErr: any) {
        console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/agent/chat:db', error: dbErr?.message || String(dbErr) }));
      }
    }

    res.json({
      intent,
      reply: answerMarkdown,
      diagnosis,
      citations,
      toolCalls,
      latencyMs,
    });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'POST /api/agent/chat', error: error?.message || String(error) }));
    res.status(503).json({
      error: 'ai_unavailable',
      message: getFriendlyErrorMessage(language),
    });
  }
});

// 2. Transcribe voice audio endpoint
agentRouter.post('/transcribe', requireAuth, rateLimitAI, audioUpload.single('audio'), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const user = req.user!;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'missing_audio', message: 'Audio file is required' });
    return;
  }

  const targetLanguage = (req.body?.language || user.preferredLanguage || 'en').trim();
  const rawMime = (file.mimetype || '').split(';')[0].toLowerCase();
  const ALLOWED_AUDIO_TYPES = [
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/wav',
    'audio/x-wav',
    'audio/x-m4a',
    'audio/m4a',
    'audio/aac',
    'audio/mpeg',
    'application/octet-stream',
  ];

  if (rawMime && !ALLOWED_AUDIO_TYPES.includes(rawMime)) {
    res.status(400).json({
      error: 'unsupported_audio',
      message: 'Supported audio formats: WEBM, WAV, MP4, AAC, OGG up to 10 MB.',
    });
    return;
  }

  try {
    const ai = getGemini();
    const effectiveMime =
      rawMime === 'audio/x-wav'
        ? 'audio/wav'
        : rawMime === 'audio/x-m4a' || rawMime === 'audio/m4a' || rawMime === 'audio/aac'
        ? 'audio/mp4'
        : rawMime === 'application/octet-stream' || !rawMime
        ? 'audio/webm'
        : rawMime;

    const langNames: Record<string, string> = {
      en: 'English',
      hi: 'Hindi',
      ml: 'Malayalam',
      ta: 'Tamil',
    };
    const targetLangName = langNames[targetLanguage] || targetLanguage;

    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_FLASH,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: effectiveMime,
                  data: file.buffer.toString('base64'),
                },
              },
              {
                text: `Transcribe this operator's spoken CNC question accurately in ${targetLangName} (${targetLanguage}). Transcribe directly in the original script of this language without translating. Return ONLY the plain transcription text.`,
              },
            ],
          },
        ],
      });
    }, targetLanguage);

    const transcript = (response.text || '').trim();
    const latencyMs = Date.now() - startTime;

    logAIRequest({
      route: '/api/agent/transcribe',
      uid: user.uid,
      language: targetLanguage,
      model: MODEL_FLASH,
      latencyMs,
    });

    res.json({ transcript });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'POST /api/agent/transcribe', error: error?.message || String(error) }));
    res.status(503).json({
      error: 'transcribe_failed',
      message: getFriendlyErrorMessage(targetLanguage),
    });
  }
});

// 2. Image access endpoint (returns signed URL for Cloud Storage paths)
agentRouter.get('/image', requireAuth, async (req: Request, res: Response) => {
  const imagePath = req.query.path as string;
  const user = req.user!;

  if (!imagePath || typeof imagePath !== 'string') {
    res.status(400).json({ error: 'invalid_path', message: 'Missing image path' });
    return;
  }

  // Owner check: path must belong to current user
  if (!imagePath.startsWith(`chats/${user.uid}/`)) {
    res.status(403).json({ error: 'forbidden', message: 'You do not have permission to access this image' });
    return;
  }

  try {
    const bucket = adminStorage.bucket();
    const file = bucket.file(imagePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: 'not_found', message: 'Image not found' });
      return;
    }

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    if (req.headers.accept?.includes('image/') || req.query.redirect === 'true') {
      res.redirect(signedUrl);
      return;
    }

    res.json({ url: signedUrl });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'GET /api/agent/image', error: error?.message || String(error) }));
    res.status(500).json({ error: 'storage_error', message: 'Failed to generate signed URL' });
  }
});

// Delete chat session and its subcollection messages
agentRouter.delete('/chat/:chatId', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const { chatId } = req.params;
  if (!chatId) {
    res.status(400).json({ error: 'missing_chat_id', message: 'Chat ID is required' });
    return;
  }

  try {
    const chatRef = adminDb.collection('users').doc(user.uid).collection('chats').doc(chatId);
    const msgsSnap = await chatRef.collection('messages').get();

    if (!msgsSnap.empty) {
      const batches = [];
      let currentBatch = adminDb.batch();
      let count = 0;
      msgsSnap.docs.forEach((docSnap) => {
        currentBatch.delete(docSnap.ref);
        count++;
        if (count % 400 === 0) {
          batches.push(currentBatch.commit());
          currentBatch = adminDb.batch();
        }
      });
      batches.push(currentBatch.commit());
      await Promise.all(batches);
    }

    await chatRef.delete();
    res.json({ success: true, deletedChatId: chatId });
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', route: 'DELETE /api/agent/chat/:chatId', error: err?.message || String(err) }));
    res.status(500).json({ error: 'delete_failed', message: err?.message || 'Failed to delete chat' });
  }
});

