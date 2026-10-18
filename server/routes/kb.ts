import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { adminDb, adminStorage } from '../firebase.js';
import { getGemini } from '../geminiClient.js';
import { requireAuth, requireAdmin } from '../authMiddleware.js';

export const kbRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

let cachedFileSearchStoreName: string | null = null;
export async function getFileSearchStoreName(): Promise<string> {
  if (cachedFileSearchStoreName) return cachedFileSearchStoreName;

  try {
    const configDoc = await adminDb.collection('config').doc('app').get();
    if (configDoc.exists && configDoc.data()?.fileSearchStoreName) {
      cachedFileSearchStoreName = configDoc.data()!.fileSearchStoreName;
      return cachedFileSearchStoreName!;
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', route: 'getFileSearchStoreName:readConfig', error: err?.message || String(err) }));
  }

  // Look for existing store in Gemini API
  try {
    const ai = getGemini();
    const pager = await ai.fileSearchStores.list();
    for await (const store of pager) {
      if (store.displayName === 'cnc-copilot-manuals' && store.name) {
        cachedFileSearchStoreName = store.name;
        try {
          await adminDb.collection('config').doc('app').set({ fileSearchStoreName: store.name }, { merge: true });
        } catch {
          // Ignore if permission error
        }
        return cachedFileSearchStoreName;
      }
    }

    // Create new store if none exists
    const created = await ai.fileSearchStores.create({
      config: { displayName: 'cnc-copilot-manuals' },
    });
    if (created.name) {
      cachedFileSearchStoreName = created.name;
      try {
        await adminDb.collection('config').doc('app').set({ fileSearchStoreName: created.name }, { merge: true });
      } catch {}
      return cachedFileSearchStoreName;
    }
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', route: 'getFileSearchStoreName:geminiList', error: err?.message || String(err) }));
  }

  cachedFileSearchStoreName = 'fileSearchStores/cnccopilotmanuals-xiae3em7kfrf';
  return cachedFileSearchStoreName;
}

export function extractPdfPageCount(buffer: Buffer): number {
  try {
    const text = buffer.toString('latin1');
    const countMatches = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/gi)];
    if (countMatches.length > 0) {
      const counts = countMatches.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n) && n > 0);
      if (counts.length > 0) return Math.max(...counts);
    }
    const altMatches = [...text.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/gi)];
    if (altMatches.length > 0) {
      const counts = altMatches.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n) && n > 0);
      if (counts.length > 0) return Math.max(...counts);
    }
    const pageMatches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    if (pageMatches && pageMatches.length > 0) return pageMatches.length;
  } catch (err: any) {
    console.warn(JSON.stringify({ level: 'warn', fn: 'extractPdfPageCount', error: err?.message || String(err) }));
  }
  return 1;
}

// Upload endpoint
kbRouter.post('/upload', requireAuth, requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
  const user = req.user!;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'no_file', message: 'No file uploaded' });
    return;
  }

  const allowedExtensions = ['.pdf', '.docx', '.xlsx', '.csv', '.txt', '.png', '.jpg', '.jpeg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    res.status(400).json({
      error: 'invalid_file_type',
      message: `Unsupported file type: ${ext}. Allowed: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG`,
    });
    return;
  }

  const { name, controller, docType, refCode, pages } = req.body;
  const docTitle = (name || file.originalname.replace(/\.[^/.]+$/, '')).trim();
  const selectedController = (controller || 'Generic').trim();
  const selectedDocType = (docType || 'OEM Manual').trim();
  const selectedRefCode = (refCode || `KB-${Date.now().toString().slice(-6)}`).trim();
  let pageCount = Number(pages) || 0;
  if (pageCount <= 0 && (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf'))) {
    pageCount = extractPdfPageCount(file.buffer);
  }
  if (pageCount <= 0) pageCount = 1;

  const docRef = adminDb.collection('kb_docs').doc();
  const docId = docRef.id;
  const storagePath = `manuals/${docId}/${file.originalname}`;

  // 1. Save file to Cloud Storage
  try {
    const bucket = adminStorage.bucket();
    const storageFile = bucket.file(storagePath);
    await storageFile.save(file.buffer, {
      metadata: { contentType: file.mimetype },
      resumable: false,
    });
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', route: 'POST /api/kb/upload:storageSave', error: err?.message || String(err) }));
    res.status(500).json({ error: 'storage_error', message: 'Failed to save file to Cloud Storage' });
    return;
  }

  // 2. Create kb_docs/{docId} in Firestore with status Indexing
  const kbData = {
    id: docId,
    name: docTitle,
    controller: selectedController,
    docType: selectedDocType,
    refCode: selectedRefCode,
    pages: pageCount,
    status: 'Indexing',
    progress: 20,
    dateAdded: new Date().toISOString().split('T')[0],
    storagePath,
    filename: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    createdAt: new Date().toISOString(),
    uploadedBy: user.uid,
  };

  try {
    await docRef.set(kbData);
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', route: 'POST /api/kb/upload:firestoreCreate', error: err?.message || String(err) }));
    res.status(500).json({ error: 'db_error', message: 'Failed to record document in database' });
    return;
  }

  // 3. Upload to Gemini File Search Store and poll
  try {
    const storeName = await getFileSearchStoreName();
    const ai = getGemini();

    const normalizedCtrl = selectedController.toLowerCase().includes('fanuc')
      ? 'fanuc'
      : selectedController.toLowerCase().includes('mitsubishi')
      ? 'mitsubishi'
      : 'generic';

    let op = await ai.fileSearchStores.uploadToFileSearchStore({
      fileSearchStoreName: storeName,
      file: new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      config: {
        mimeType: file.mimetype,
        displayName: docTitle,
        customMetadata: [
          { key: 'controller', stringValue: normalizedCtrl },
          { key: 'docType', stringValue: selectedDocType },
        ],
      },
    });

    const startTime = Date.now();
    while (!op.done) {
      if (Date.now() - startTime > 120000) {
        throw new Error('Indexing timed out after 120 seconds');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      op = await ai.operations.get({ operation: op });
    }

    if (op.error) {
      console.error(JSON.stringify({ level: 'error', route: 'POST /api/kb/upload:operationError', error: JSON.stringify(op.error) }));
      await docRef.update({
        status: 'Error',
        error: JSON.stringify(op.error),
      });
      res.status(500).json({ error: 'indexing_failed', message: 'Document indexing failed in File Search' });
      return;
    }

    const fileSearchDocName = op.response?.documentName || '';
    await docRef.update({
      status: 'Ready',
      progress: 100,
      fileSearchDocumentName: fileSearchDocName,
    });

    res.json({
      success: true,
      docId,
      name: docTitle,
      fileSearchDocumentName: fileSearchDocName,
      status: 'Ready',
    });
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', route: 'POST /api/kb/upload:geminiUpload', error: err?.message || String(err) }));
    try {
      await docRef.update({ status: 'Error', error: err?.message || String(err) });
    } catch {}
    res.status(500).json({ error: 'indexing_failed', message: err?.message || 'Indexing failed' });
  }
});

// Delete endpoint
kbRouter.delete('/:docId', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { docId } = req.params;
  if (!docId) {
    res.status(400).json({ error: 'invalid_id', message: 'Document ID required' });
    return;
  }

  const docRef = adminDb.collection('kb_docs').doc(docId);
  const snap = await docRef.get();
  if (!snap.exists) {
    res.status(404).json({ error: 'not_found', message: 'Document not found' });
    return;
  }

  const data = snap.data();

  // 1. Delete from Gemini File Search store if exists
  if (data?.fileSearchDocumentName) {
    try {
      const ai = getGemini();
      await ai.fileSearchStores.documents.delete({
        name: data.fileSearchDocumentName,
        config: { force: true },
      });
    } catch (err: any) {
      console.warn(JSON.stringify({ level: 'warn', route: 'DELETE /api/kb/:docId:geminiDelete', error: err?.message || String(err) }));
    }
  }

  // 2. Delete from Cloud Storage if exists
  if (data?.storagePath) {
    try {
      const bucket = adminStorage.bucket();
      const storageFile = bucket.file(data.storagePath);
      const [exists] = await storageFile.exists();
      if (exists) await storageFile.delete();
    } catch (err: any) {
      console.warn(JSON.stringify({ level: 'warn', route: 'DELETE /api/kb/:docId:storageDelete', error: err?.message || String(err) }));
    }
  }

  // 3. Delete from Firestore
  try {
    await docRef.delete();
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', route: 'DELETE /api/kb/:docId:firestoreDelete', error: err?.message || String(err) }));
    res.status(500).json({ error: 'db_error', message: 'Failed to delete document from database' });
    return;
  }

  res.json({ success: true, docId });
});

// View / Download manual file in new tab
kbRouter.get('/file/:identifier', async (req: Request, res: Response) => {
  const { identifier } = req.params;
  if (!identifier) {
    res.status(400).send('Document identifier required');
    return;
  }

  try {
    let docData: any = null;
    let docSnap = await adminDb.collection('kb_docs').doc(identifier).get();
    if (docSnap.exists) {
      docData = docSnap.data();
    } else {
      const byName = await adminDb.collection('kb_docs').where('name', '==', identifier).limit(1).get();
      if (!byName.empty) {
        docData = byName.docs[0].data();
      } else {
        const byFilename = await adminDb.collection('kb_docs').where('filename', '==', identifier).limit(1).get();
        if (!byFilename.empty) {
          docData = byFilename.docs[0].data();
        }
      }
    }

    if (!docData) {
      res.status(404).send('Document not found in knowledge base');
      return;
    }

    if (!docData.storagePath) {
      res.status(404).send('File storage path not found for this document');
      return;
    }

    const bucket = adminStorage.bucket();
    const file = bucket.file(docData.storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).send('Document file not found in storage bucket');
      return;
    }

    const mime = docData.mimeType || 'application/pdf';
    const rawFilename = docData.filename || `${docData.name || 'manual'}.pdf`;
    const cleanFilename = path.basename(rawFilename);
    const isDownload = req.query.download === 'true' || req.query.download === '1';

    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `${isDownload ? 'attachment' : 'inline'}; filename="${cleanFilename}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`
    );
    file.createReadStream().pipe(res);
  } catch (err: any) {
    console.error(JSON.stringify({ level: 'error', route: 'GET /api/kb/file/:identifier', error: err?.message || String(err) }));
    res.status(500).send('Failed to retrieve document file');
  }
});

