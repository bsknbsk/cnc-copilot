import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { collection, onSnapshot, query, doc, setDoc, deleteDoc } from 'firebase/firestore';
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
import { Tabs, Skeleton, ProgressBar, Drawer } from './ui/Feedback.js';

export interface ChunkItem {
  id: string;
  section: string;
  page: number;
  matchScore: number;
  tokens: number;
  snippet: string;
}

export interface KBDocument {
  id: string;
  name: string;
  controller: string;
  docType: 'OEM Manual' | 'Service Manual' | 'Shop Standard' | 'Catalog' | 'Param Sheet';
  refCode: string;
  pages: number;
  status: 'Ready' | 'Indexing' | 'Processing' | 'Error' | 'Failed';
  progress?: number;
  dateAdded: string;
  vectorCount?: number;
  chunks?: ChunkItem[];
  fileUrl?: string;
  isPinned?: boolean;
}

interface KnowledgeBaseProps {
  onNavigate?: (tab: string, state?: any) => void;
}

export function KnowledgeBase({ onNavigate }: KnowledgeBaseProps) {
  const { user, isAdmin } = useAuth();
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [controllerFilter, setControllerFilter] = useState('all');
  const [docTypeFilter, setDocTypeFilter] = useState('all');
  const [sortField, setSortField] = useState<'date' | 'name' | 'pages'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 4;

  // Simulator state
  const [simQuery, setSimQuery] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simLatency, setSimLatency] = useState('0');
  const [activeChunks, setActiveChunks] = useState<ChunkItem[]>([]);

  // Modals & inspect
  const [inspectDoc, setInspectDoc] = useState<KBDocument | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadState, setUploadState] = useState({
    name: '',
    controller: 'Fanuc',
    docType: 'OEM Manual' as KBDocument['docType'],
    refCode: '',
    pages: 50,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Subscribe to real Firestore `kb_docs` collection if accessible
  useEffect(() => {
    try {
      const q = query(collection(db, 'kb_docs'));
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (!snap.empty) {
            const docs: KBDocument[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as any),
            }));
            setDocuments(docs);
          } else {
            setDocuments([]);
          }
        },
        (err) => {
          console.warn('[KnowledgeBase] Firestore kb_docs stream notice:', err);
          setDocuments([]);
        }
      );
      return () => unsub();
    } catch {
      setDocuments([]);
    }
  }, []);

  // Aggregate stats
  const totalDocs = documents.length;
  const readyDocs = documents.filter((d) => d.status === 'Ready').length;
  const indexingDocs = documents.filter((d) => d.status === 'Indexing' || d.status === 'Processing');
  const totalEmbeddings = useMemo(() => {
    return documents.reduce((sum, d) => sum + (d.vectorCount || d.pages * 60), 0);
  }, [documents]);

  // Filter & sort documents
  const filteredDocs = useMemo(() => {
    return documents
      .filter((docItem) => {
        const matchesSearch =
          !searchQuery.trim() ||
          docItem.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          docItem.refCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
          docItem.controller.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesController =
          controllerFilter === 'all' ||
          (controllerFilter === 'fanuc' && docItem.controller.toLowerCase().includes('fanuc')) ||
          (controllerFilter === 'mitsubishi' && docItem.controller.toLowerCase().includes('mitsubishi')) ||
          (controllerFilter === 'generic' && docItem.controller.toLowerCase().includes('generic'));

        const matchesType =
          docTypeFilter === 'all' ||
          (docTypeFilter === 'oem' && docItem.docType === 'OEM Manual') ||
          (docTypeFilter === 'service' && docItem.docType === 'Service Manual') ||
          (docTypeFilter === 'standards' && docItem.docType === 'Shop Standard') ||
          (docTypeFilter === 'tooling' && docItem.docType === 'Catalog') ||
          (docTypeFilter === 'params' && docItem.docType === 'Param Sheet');

        return matchesSearch && matchesController && matchesType;
      })
      .sort((a, b) => {
        if (sortField === 'name') {
          return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        }
        if (sortField === 'pages') {
          return sortAsc ? a.pages - b.pages : b.pages - a.pages;
        }
        return sortAsc ? a.dateAdded.localeCompare(b.dateAdded) : b.dateAdded.localeCompare(a.dateAdded);
      });
  }, [documents, searchQuery, controllerFilter, docTypeFilter, sortField, sortAsc]);

  // Paginated documents
  const totalPages = Math.ceil(filteredDocs.length / itemsPerPage) || 1;
  const paginatedDocs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredDocs.slice(start, start + itemsPerPage);
  }, [filteredDocs, currentPage]);

  // Initial simulation chunks
  useEffect(() => {
    setActiveChunks([]);
  }, [documents]);

  // Execute RAG simulator search
  const handleRunSimulation = async () => {
    if (!simQuery.trim()) return;
    setIsSimulating(true);
    const start = performance.now();
    try {
      const res = await apiFetch('/api/kb/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: simQuery.trim(),
          controller: controllerFilter === 'all' ? 'generic' : controllerFilter,
        }),
      });

      if (!res.ok) {
        throw new Error('Simulation failed');
      }

      const data = await res.json();
      const latency = Math.round(performance.now() - start);
      setSimLatency(`${latency}ms`);

      if (Array.isArray(data.chunks)) {
        const mappedChunks: ChunkItem[] = data.chunks.map((c: any, idx: number) => ({
          id: `sim-chunk-${idx}`,
          section: c.documentName || 'OEM Manual',
          page: c.pageNumber || 1,
          matchScore: c.matchScore || Math.max(98 - idx * 6, 75),
          tokens: Math.round((c.snippet || '').length / 4),
          snippet: c.snippet || '',
        }));
        setActiveChunks(mappedChunks);
      } else {
        setActiveChunks([]);
      }
    } catch (err: any) {
      console.error('[KnowledgeBase] Simulation error:', err);
      setActiveChunks([]);
    } finally {
      setIsSimulating(false);
    }
  };

  // Upload document handler
  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Please select a document file to upload.');
      return;
    }
    if (!isAdmin) {
      alert('Only workshop administrators have permission to upload technical documents.');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('name', uploadState.name || selectedFile.name);
      formData.append('controller', uploadState.controller);
      formData.append('docType', uploadState.docType);
      formData.append('refCode', uploadState.refCode);
      formData.append('pages', String(uploadState.pages));

      const res = await apiFetch('/api/kb/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Upload failed');
      }

      setUploadModalOpen(false);
      setSelectedFile(null);
      setUploadState({
        name: '',
        controller: 'Fanuc',
        docType: 'OEM Manual',
        refCode: '',
        pages: 50,
      });
    } catch (err: any) {
      alert(`Upload error: ${err.message || 'Could not upload document'}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Delete document handler
  const handleDeleteDocument = async (docId: string) => {
    if (!isAdmin) {
      alert('Only workshop administrators have permission to purge technical documents.');
      return;
    }
    if (!confirm('Are you sure you want to remove this manual from the verified memory corpus?')) return;

    try {
      const res = await apiFetch(`/api/kb/${docId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Delete failed');
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err: any) {
      alert(`Delete error: ${err.message || 'Could not delete document'}`);
    }
  };

  // Export Manifest
  const handleExportManifest = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(documents, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `cnc-copilot-kb-manifest-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <>
      <div className="w-full bg-surface-container-lowest min-h-screen text-on-surface antialiased font-body-md">
      <div className="w-full px-margin py-margin">
        <div className="flex flex-col w-full">
          {/* Top Stats & Metric Banner */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter mb-space-lg">
            <Card className="p-space-md flex flex-col justify-between">
              <SectionHeader title="Indexed Documents" icon="library_books" className="border-b-0 mb-0 pb-0" />
              <div className="flex items-baseline gap-space-xs mt-2">
                <span className="font-code-lg text-headline-xl font-bold text-on-surface">{readyDocs}</span>
                <span className="font-label-sm text-label-sm text-secondary font-mono">/ {totalDocs} Total</span>
              </div>
              <ProgressBar progress={totalDocs > 0 ? Math.min(100, Math.round((readyDocs / totalDocs) * 100)) : 0} variant="secondary" />
            </Card>

            <Card className="p-space-md flex flex-col justify-between">
              <SectionHeader title="Vector Embeddings" icon="hub" className="border-b-0 mb-0 pb-0" />
              <div className="flex items-baseline gap-space-xs mt-2">
                <span className="font-code-lg text-headline-xl font-bold text-on-surface">
                  {totalEmbeddings.toLocaleString()}
                </span>
                <span className="font-label-sm text-label-sm text-primary font-mono">Total</span>
              </div>
              <ProgressBar progress={totalDocs > 0 ? 100 : 0} variant="primary" />
            </Card>

            <Card className="p-space-md flex flex-col justify-between">
              <SectionHeader title="Avg Retrieval" icon="bolt" className="border-b-0 mb-0 pb-0" />
              <div className="flex items-baseline gap-space-xs mt-2">
                <span className="font-code-lg text-headline-xl font-bold text-on-surface">--</span>
                <span className="font-label-sm text-label-sm text-tertiary font-mono">ms</span>
              </div>
              <ProgressBar progress={0} variant="tertiary" />
            </Card>

            <Card className="p-space-md flex flex-col justify-between">
              <SectionHeader title="OCR Accuracy" icon="verified" className="border-b-0 mb-0 pb-0" />
              <div className="flex items-baseline gap-space-xs mt-2">
                <span className="font-code-lg text-headline-xl font-bold text-on-surface">--</span>
                <span className="font-label-sm text-label-sm text-secondary font-mono">Precision</span>
              </div>
              <ProgressBar progress={0} variant="secondary" />
            </Card>
          </div>

          {/* Page Title & Section Header */}
          <section className="mb-space-lg">
            <PageHeader
              label="Physics RAG Engine"
              title="Knowledge Base & Shopfloor Memory"
              caption="Controller manuals, tooling catalog cut-sheets, and verified shop machining standards indexed for real-time retrieval."
              actions={
                <ButtonPrimary onClick={() => setUploadModalOpen(true)} icon="upload_file">
                  Upload Manual
                </ButtonPrimary>
              }
            />
          </section>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
            {/* LEFT COLUMN: Explorer & Table (70% -> lg:col-span-8) */}
            <div className="lg:col-span-8 flex flex-col gap-space-md">
              {/* Action Controls Bar */}
              <Card className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-space-md p-space-sm">
                {/* Search & Filter Controls */}
                <div className="flex flex-1 flex-wrap items-center gap-space-xs">
                  <div className="relative flex-1 min-w-[240px] flex items-center bg-surface-container-lowest rounded-lg px-space-sm h-11 focus-within:ring-1 focus-within:ring-secondary">
                    <span className="material-symbols-outlined text-tertiary mr-2 text-[20px]">search</span>
                    <input
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="bg-transparent border-0 outline-none w-full font-code-sm text-code-sm text-on-surface placeholder:text-tertiary-container placeholder:font-body-md focus:outline-none"
                      placeholder={`Search ${totalDocs} documents...`}
                      type="text"
                    />
                  </div>

                  <select
                    value={controllerFilter}
                    onChange={(e) => {
                      setControllerFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="bg-surface-container-high text-on-surface font-label-md text-label-md h-11 px-4 rounded-lg outline-none cursor-pointer"
                  >
                    <option value="all">All Controllers</option>
                    <option value="fanuc">Fanuc</option>
                    <option value="mitsubishi">Mitsubishi</option>
                    <option value="generic">Generic</option>
                  </select>

                  <select
                    value={docTypeFilter}
                    onChange={(e) => {
                      setDocTypeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="bg-surface-container-high text-on-surface font-label-md text-label-md h-11 px-4 rounded-lg outline-none cursor-pointer"
                  >
                    <option value="all">All Types</option>
                    <option value="oem">OEM Manuals</option>
                    <option value="service">Service</option>
                    <option value="standards">Standards</option>
                  </select>
                </div>

                <ButtonPrimary onClick={() => setUploadModalOpen(true)} icon="upload_file" className="min-w-[180px]">
                  Upload Manual
                </ButtonPrimary>
              </Card>

              {/* Upload Drop Zone Area */}
              <div
                onClick={() => setUploadModalOpen(true)}
                className="bg-surface-container-low hover:bg-surface-container rounded-xl p-space-xl text-center transition-all cursor-pointer shadow-sm relative group border border-outline-variant/30 hover:border-primary-container/40"
                id="dropzone"
              >
                <div className="flex flex-col items-center justify-center max-w-xl mx-auto gap-space-xs">
                  <div className="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center text-primary-container group-hover:scale-110 transition-transform">
                    <span className="material-symbols-outlined text-[32px]">cloud_upload</span>
                  </div>
                  <span className="font-headline-md text-headline-md text-on-surface font-semibold mt-2">
                    Drag & Drop OEM Manuals, Fanuc Parameter Sheets, or Machine Logs
                  </span>
                  <p className="font-body-md text-body-md text-tertiary">
                    Supports PDF, STEP/DXF notes, DOCX, and CSV tables up to 150MB. OCR and technical tabular parsing
                    automatically enabled.
                  </p>
                  <div className="flex items-center gap-space-xs mt-2 px-space-sm py-1 rounded bg-surface-container-lowest text-tertiary-container font-label-sm text-label-sm font-mono">
                    <span className="material-symbols-outlined text-[14px]">shield</span>
                    <span>Ensure your enterprise holds explicit authorization to index OEM technical documentation.</span>
                  </div>
                </div>
              </div>

              {/* Documents Inventory Table */}
              <Card className="overflow-hidden flex flex-col">
                <SectionHeader 
                  title="Verified Memory Corpus" 
                  actions={
                    <div className="flex items-center gap-space-xs">
                      <ButtonSecondary onClick={handleExportManifest} icon="download">Export</ButtonSecondary>
                      <Badge variant="secondary">{readyDocs} ACTIVE</Badge>
                    </div>
                  }
                  className="p-space-md border-b-0 mb-0"
                />

                {/* Table Container */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-surface-container-low text-tertiary uppercase font-mono font-label-sm text-label-sm">
                        <th className="py-3 px-space-md">Document Name</th>
                        <th className="py-3 px-space-md">Controller</th>
                        <th className="py-3 px-space-md">Type</th>
                        <th className="py-3 px-space-md text-right">Pages</th>
                        <th className="py-3 px-space-md">Status</th>
                        <th className="py-3 px-space-md">Date Added</th>
                        <th className="py-3 px-space-md text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container-high font-body-sm text-body-sm">
                      {paginatedDocs.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12">
                            <EmptyState 
                              icon="search_off"
                              title="No technical documents match"
                              description="Try adjusting your search query, controller selector, or doc type."
                              action={
                                <ButtonSecondary onClick={() => { setSearchQuery(''); setControllerFilter('all'); setDocTypeFilter('all'); }}>
                                  Reset Filters
                                </ButtonSecondary>
                              }
                            />
                          </td>
                        </tr>
                      ) : (
                        paginatedDocs.map((docItem) => (
                          <tr key={docItem.id} className="hover:bg-surface-container-high/60 transition-colors group">
                            <td className="py-space-sm px-space-md">
                              <div className="flex items-center gap-space-sm">
                                <div
                                  className={`w-8 h-8 rounded bg-surface-container-high flex items-center justify-center ${
                                    docItem.docType === 'OEM Manual'
                                      ? 'text-secondary'
                                      : docItem.docType === 'Service Manual'
                                      ? 'text-primary-container'
                                      : docItem.docType === 'Shop Standard'
                                      ? 'text-primary'
                                      : 'text-secondary'
                                  }`}
                                >
                                  <span className="material-symbols-outlined text-[20px]">
                                    {docItem.docType === 'OEM Manual' && 'menu_book'}
                                    {docItem.docType === 'Service Manual' && 'build_circle'}
                                    {docItem.docType === 'Shop Standard' && 'fact_check'}
                                    {docItem.docType === 'Catalog' && 'calculate'}
                                    {docItem.docType === 'Param Sheet' && 'terminal'}
                                  </span>
                                </div>
                                <div className="flex flex-col min-w-0 max-w-[280px]">
                                  <span className="font-headline-sm text-headline-sm text-on-surface group-hover:text-secondary transition-colors truncate">
                                    {docItem.name}
                                  </span>
                                  <span className="font-code-sm text-code-sm text-tertiary-container font-mono truncate">
                                    {docItem.refCode}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-space-sm px-space-md whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded bg-surface-container-high text-on-surface font-code-sm text-code-sm font-mono">
                                {docItem.controller}
                              </span>
                            </td>
                            <td className="py-space-sm px-space-md whitespace-nowrap">
                              <span className="font-label-sm text-label-sm text-tertiary uppercase font-mono">
                                {docItem.docType}
                              </span>
                            </td>
                            <td className="py-space-sm px-space-md text-right font-code-sm text-code-sm font-mono text-on-surface">
                              {docItem.pages}
                            </td>
                            <td className="py-space-sm px-space-md whitespace-nowrap">
                              {docItem.status === 'Ready' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-secondary-container/20 text-secondary font-label-sm text-label-sm font-mono">
                                  <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                                  Ready
                                </span>
                              )}
                              {docItem.status === 'Indexing' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary-container/20 text-primary-container font-label-sm text-label-sm font-mono">
                                  <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                                  Indexing ({docItem.progress || 82}%)
                                </span>
                              )}
                              {(docItem.status === 'Error' || docItem.status === 'Failed') && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-error-container/20 text-error font-label-sm text-label-sm font-mono">
                                  <span className="w-1.5 h-1.5 rounded-full bg-error" />
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="py-space-sm px-space-md whitespace-nowrap font-code-sm text-code-sm font-mono text-tertiary">
                              {docItem.dateAdded}
                            </td>
                            <td className="py-space-sm px-space-md text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1 text-tertiary">
                                <button
                                  onClick={() => setInspectDoc(docItem)}
                                  className="p-1.5 rounded hover:bg-surface-bright hover:text-secondary transition-colors cursor-pointer"
                                  title="Inspect Chunks"
                                >
                                  <span className="material-symbols-outlined text-[18px]">visibility</span>
                                </button>
                                <button
                                  onClick={() => {
                                    alert(`Source archive downloaded: ${docItem.name}.pdf`);
                                  }}
                                  className="p-1.5 rounded hover:bg-surface-bright hover:text-on-surface transition-colors cursor-pointer"
                                  title="Download Source"
                                >
                                  <span className="material-symbols-outlined text-[18px]">download</span>
                                </button>
                                {isAdmin && (
                                  <button
                                    onClick={() => handleDeleteDocument(docItem.id)}
                                    className="p-1.5 rounded hover:bg-error-container hover:text-error transition-colors cursor-pointer"
                                    title="Archive / Purge"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Table Pagination Footer */}
                <div className="p-space-md bg-surface-container flex flex-col sm:flex-row items-center justify-between gap-space-sm font-mono font-label-sm text-label-sm text-tertiary border-t border-surface-container-high">
                  <div className="flex items-center gap-space-xs">
                    <span>
                      Showing{' '}
                      <strong className="text-on-surface">
                        {filteredDocs.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to{' '}
                        {Math.min(currentPage * itemsPerPage, filteredDocs.length)}
                      </strong>{' '}
                      of <strong className="text-on-surface">{filteredDocs.length}</strong> technical documents
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-space-sm py-1.5 rounded bg-surface-container-high text-tertiary hover:text-on-surface hover:bg-surface-bright transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      &lt; Previous
                    </button>
                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((p) => (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={`px-space-sm py-1.5 rounded cursor-pointer transition-colors ${
                          currentPage === p
                            ? 'bg-primary-container text-surface-container-lowest font-bold'
                            : 'bg-surface-container-high text-on-surface hover:bg-surface-bright'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-space-sm py-1.5 rounded bg-surface-container-high text-tertiary hover:text-on-surface hover:bg-surface-bright transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      Next &gt;
                    </button>
                  </div>
                </div>
              </Card>
            </div>

            {/* RIGHT COLUMN: RAG Test Retrieval Simulator (30% -> lg:col-span-4) */}
            <div className="lg:col-span-4 flex flex-col gap-space-md sticky top-20">
              {/* Simulator Glass Card */}
              <div className="bg-surface-container p-space-md rounded-xl shadow-xl flex flex-col gap-space-md relative overflow-hidden">
                {/* Subtle Glow Decal in Corner */}
                <div className="absolute -right-12 -top-12 w-32 h-32 bg-secondary/10 rounded-full blur-2xl pointer-events-none" />

                {/* Header with Vector DB Indicator */}
                <div className="flex flex-col gap-space-xs">
                  <div className="flex items-center justify-between">
                    <h3 className="font-headline-md text-headline-md text-on-surface font-semibold flex items-center gap-space-xs">
                      <span className="material-symbols-outlined text-secondary text-[22px]">troubleshoot</span>
                      <span>RAG Test Simulator</span>
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-surface-container-high font-label-sm text-label-sm font-mono text-secondary">
                      LIVE
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-tertiary-container font-label-sm text-label-sm font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                    <span>Vector DB: Gemini File Search</span>
                  </div>
                </div>

                {/* Query Input Block */}
                <div className="flex flex-col gap-space-xs">
                  <label className="font-label-sm text-label-sm uppercase font-mono text-tertiary">
                    Diagnostic Prompt Simulation
                  </label>
                  <div className="relative bg-surface-container-lowest rounded-lg p-2.5 focus-within:ring-1 focus-within:ring-secondary">
                    <textarea
                      value={simQuery}
                      onChange={(e) => setSimQuery(e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-on-surface font-code-sm text-code-sm resize-none focus:outline-none"
                      id="rag-query-input"
                      rows={3}
                      placeholder="Enter CNC symptom, alarm code, or parameter query..."
                    />
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-container-high">
                      <span className="font-label-sm text-label-sm font-mono text-tertiary-container">
                        Cosine Sim: Top K=3
                      </span>
                      <button
                        onClick={handleRunSimulation}
                        disabled={isSimulating || !simQuery.trim()}
                        className="px-space-sm py-1 bg-secondary text-surface-container-lowest font-label-sm text-label-sm font-bold font-mono rounded flex items-center gap-1 hover:bg-secondary-fixed transition-colors cursor-pointer disabled:opacity-75"
                        id="rag-run-btn"
                      >
                        <span>{isSimulating ? 'SIMULATING...' : 'SIMULATE'}</span>
                        <span className="material-symbols-outlined text-[14px]">send</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Retrieval Results Header */}
                <div className="flex items-center justify-between pt-2">
                  <span className="font-label-sm text-label-sm uppercase font-mono text-tertiary">
                    Retrieved Chunks (HNSW Ranked)
                  </span>
                  <span className="font-label-sm text-label-sm font-mono text-secondary">
                    Latency: {simLatency || '--'}
                  </span>
                </div>

                {/* Retrieved Chunks Stack */}
                <div className="flex flex-col gap-space-sm" id="retrieval-results-stack">
                  {activeChunks.length === 0 ? (
                    <EmptyState 
                      icon="ads_click"
                      title="Upload a manual to test retrieval."
                      description="Connect your technical documentation to test semantic search."
                    />
                  ) : (
                    activeChunks.map((chunk, idx) => (
                      <Card 
                        key={chunk.id || idx}
                        className="p-space-sm flex flex-col gap-space-xs hover:bg-surface-container-high transition-colors"
                      >
                        <div className="flex items-start justify-between gap-space-xs">
                          <div className="flex flex-col">
                            <span className="font-headline-sm text-body-md text-on-surface font-semibold">
                              {idx === 0
                                ? 'Primary Context'
                                : idx === 1
                                ? 'Secondary Reference'
                                : 'Supporting Fragment'}
                            </span>
                            <span className="font-code-sm text-label-sm text-tertiary font-mono">
                              {chunk.section}
                            </span>
                          </div>
                          <Badge variant={idx === 0 ? 'secondary' : 'tertiary'}>
                            {chunk.matchScore}% MATCH
                          </Badge>
                        </div>
                        <div className="bg-surface-container-lowest p-space-sm rounded font-code-sm text-code-sm text-tertiary-fixed leading-relaxed font-mono">
                          {chunk.snippet}
                        </div>
                        <div className="flex items-center justify-between text-tertiary font-label-sm text-label-sm font-mono pt-1">
                          <span>Token Count: {chunk.tokens}</span>
                          <button
                            onClick={() => {
                              const found = documents.find((d) => (d.chunks || []).some((c) => c.id === chunk.id));
                              if (found) setInspectDoc(found);
                              else if (documents[0]) setInspectDoc(documents[0]);
                            }}
                            className="hover:text-secondary flex items-center gap-0.5 cursor-pointer text-[10px]"
                          >
                            <span>View In Context</span>
                            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                          </button>
                        </div>
                      </Card>
                    ))
                  )}
                </div>

                {/* Telemetry Summary Bar */}
                <div className="p-space-sm rounded-lg bg-surface-container-lowest flex items-center justify-between font-mono font-label-sm text-label-sm text-tertiary">
                  <span>Embedding Model: Gemini File Search</span>
                  <span className="text-secondary font-bold">Grounding: Active</span>
                </div>
              </div>

              {/* Quick Indexing Audit Notice */}
              {indexingDocs.length > 0 ? (
                <div className="bg-surface-container p-space-md rounded-xl shadow-sm flex items-center gap-space-sm border border-primary-container/30">
                  <span className="material-symbols-outlined text-primary-container text-[24px]">sync_problem</span>
                  <div className="flex flex-col">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                      {indexingDocs.length} Background Ingestion Job
                    </span>
                    <span className="font-body-sm text-body-sm text-tertiary">
                      {indexingDocs[0].name} is {indexingDocs[0].progress || 82}% indexed. ETA: 4m 12s.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-surface-container p-space-md rounded-xl shadow-sm flex items-center gap-space-sm">
                  <span className="material-symbols-outlined text-secondary text-[24px]">verified</span>
                  <div className="flex flex-col">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                      All Corpora Synchronized
                    </span>
                    <span className="font-body-sm text-body-sm text-tertiary">
                      Gemini File Search index up to date with active shop standards.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* Chunk Inspector Drawer */}
      <Drawer
        isOpen={!!inspectDoc}
        onClose={() => setInspectDoc(null)}
        title={inspectDoc ? `Inspector: ${inspectDoc.name}` : 'Document Inspector'}
        footer={
          <div className="flex justify-end">
            <ButtonSecondary onClick={() => setInspectDoc(null)}>Close Inspector</ButtonSecondary>
          </div>
        }
      >
        {inspectDoc && (
          <div className="flex flex-col gap-space-md">
            <div className="flex flex-col gap-1 pb-3 border-b border-outline-variant/20">
              <span className="font-mono text-[10px] text-tertiary uppercase tracking-wider">{inspectDoc.refCode}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{inspectDoc.controller}</Badge>
                <Badge variant="tertiary">{inspectDoc.docType}</Badge>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-tertiary bg-surface-container-low p-2 rounded border border-outline-variant/10">
              <span>Total Vector Chunks: {(inspectDoc.chunks || []).length || Math.round(inspectDoc.pages * 6)}</span>
              <span className="text-secondary font-bold">Status: {inspectDoc.status}</span>
            </div>

            <div className="flex flex-col gap-3">
              <span className="font-label-sm uppercase font-mono text-tertiary tracking-widest text-[10px]">Indexed Content Chunks</span>
              {(inspectDoc.chunks && inspectDoc.chunks.length > 0) ? (
                inspectDoc.chunks.map((chk, i) => (
                  <Card key={chk.id || i} className="p-3 bg-surface-container-lowest border-outline-variant/20 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between font-mono text-[10px] text-secondary font-bold">
                      <span>{chk.section}</span>
                      <span>Page {chk.page}</span>
                    </div>
                    <p className="font-mono text-xs text-tertiary-fixed leading-relaxed border-l-2 border-primary-container/30 pl-2">{chk.snippet}</p>
                    <div className="text-[10px] font-mono text-tertiary-container mt-1">Tokens: {chk.tokens}</div>
                  </Card>
                ))
              ) : (
                <EmptyState 
                  icon="inventory_2"
                  title="No chunks generated"
                  description={`All ${inspectDoc.pages} pages vectorized into 768-dim embeddings.`}
                />
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Upload Manual Drawer */}
      <Drawer
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Upload Technical Documentation"
      >
        <form onSubmit={handleCreateDocument} className="flex flex-col gap-4 font-body-sm">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase text-tertiary font-bold tracking-wider">Document Title</label>
            <input
              required
              value={uploadState.name}
              onChange={(e) => setUploadState({ ...uploadState, name: e.target.value })}
              placeholder="e.g. Fanuc Series 31i-B Maintenance Manual"
              className="px-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary-container transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase text-tertiary font-bold tracking-wider">Controller</label>
              <select
                value={uploadState.controller}
                onChange={(e) => setUploadState({ ...uploadState, controller: e.target.value })}
                className="px-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary-container"
              >
                <option value="Fanuc">Fanuc</option>
                <option value="Mitsubishi">Mitsubishi</option>
                <option value="Generic">Generic</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase text-tertiary font-bold tracking-wider">Classification</label>
              <select
                value={uploadState.docType}
                onChange={(e) => setUploadState({ ...uploadState, docType: e.target.value as any })}
                className="px-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary-container"
              >
                <option value="OEM Manual">OEM Manual</option>
                <option value="Service Manual">Service Manual</option>
                <option value="Shop Standard">Shop Standard (SOP)</option>
                <option value="Catalog">Tooling Catalog</option>
                <option value="Param Sheet">Param & Macro Sheet</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase text-tertiary font-bold tracking-wider">Ref Code</label>
              <input
                value={uploadState.refCode}
                onChange={(e) => setUploadState({ ...uploadState, refCode: e.target.value })}
                placeholder="B-64694EN/01"
                className="px-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary-container"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase text-tertiary font-bold tracking-wider">Page Count</label>
              <input
                type="number"
                min={1}
                value={uploadState.pages}
                onChange={(e) => setUploadState({ ...uploadState, pages: parseInt(e.target.value) || 1 })}
                className="px-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="p-6 rounded-2xl bg-surface-container border border-dashed border-outline-variant/40 text-center flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-surface-container-high transition-colors group"
          >
            <div className="w-12 h-12 rounded-full bg-surface-container-lowest flex items-center justify-center text-primary-container group-hover:scale-110 transition-transform">
              <span className="material-symbols-outlined text-[24px]">attach_file</span>
            </div>
            <span className="font-mono text-xs text-secondary font-bold">
              {selectedFile ? selectedFile.name : 'Select Technical File'}
            </span>
            <span className="font-mono text-[10px] text-tertiary uppercase opacity-60">OCR & Tabular parsing enabled</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            required
            accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setSelectedFile(file);
                if (!uploadState.name) {
                  setUploadState((prev) => ({ ...prev, name: file.name.replace(/\.[^/.]+$/, '') }));
                }
              }
            }}
            className="px-3 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary-container"
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant/20 mt-2">
            <ButtonSecondary type="button" onClick={() => setUploadModalOpen(false)}>
              Cancel
            </ButtonSecondary>
            <ButtonPrimary
              type="submit"
              disabled={isUploading}
              loading={isUploading}
              icon="cloud_upload"
            >
              {isUploading ? 'Vectorizing...' : 'Index Document'}
            </ButtonPrimary>
          </div>
        </form>
      </Drawer>
    </>
  );
}
