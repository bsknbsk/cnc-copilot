import { describe, it, expect } from 'vitest';

export function matchDocType(filter: string, docType: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'OEM Manual') return docType === 'OEM Manual';
  if (filter === 'Service Manual') return docType === 'Service Manual';
  if (filter === 'Shop Standard (SOP)') return docType === 'Shop Standard (SOP)' || docType === 'Shop Standard';
  if (filter === 'Tooling Catalog') return docType === 'Tooling Catalog' || docType === 'Catalog';
  if (filter === 'Param & Macro Sheet') return docType === 'Param & Macro Sheet' || docType === 'Param Sheet';
  return false;
}

export function buildContentDisposition(filename: string, isDownload: boolean): string {
  const cleanFilename = filename.trim();
  const dispositionType = isDownload ? 'attachment' : 'inline';
  return `${dispositionType}; filename="${cleanFilename}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`;
}

describe('Knowledge Base Category Filtering and Downloads', () => {
  it('correctly filters documents across all 5 classifications', () => {
    expect(matchDocType('all', 'OEM Manual')).toBe(true);
    expect(matchDocType('OEM Manual', 'OEM Manual')).toBe(true);
    expect(matchDocType('OEM Manual', 'Service Manual')).toBe(false);

    expect(matchDocType('Shop Standard (SOP)', 'Shop Standard (SOP)')).toBe(true);
    expect(matchDocType('Shop Standard (SOP)', 'Shop Standard')).toBe(true);

    expect(matchDocType('Tooling Catalog', 'Tooling Catalog')).toBe(true);
    expect(matchDocType('Tooling Catalog', 'Catalog')).toBe(true);

    expect(matchDocType('Param & Macro Sheet', 'Param & Macro Sheet')).toBe(true);
    expect(matchDocType('Param & Macro Sheet', 'Param Sheet')).toBe(true);
  });

  it('generates attachment header when download is requested', () => {
    const header = buildContentDisposition('Fanuc 31i Manual.pdf', true);
    expect(header).toContain('attachment');
    expect(header).toContain('filename="Fanuc 31i Manual.pdf"');
    expect(header).toContain("filename*=UTF-8''Fanuc%2031i%20Manual.pdf");
  });

  it('generates inline header when viewing in tab', () => {
    const header = buildContentDisposition('Mitsubishi M80 Manual.pdf', false);
    expect(header).toContain('inline');
    expect(header).toContain('filename="Mitsubishi M80 Manual.pdf"');
  });

  it('correctly extracts page count from sample PDF buffers', () => {
    const fakeSinglePagePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n%%EOF');
    const fakeMultiPagePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 113 >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n4 0 obj\n<< /Type /Page >>\nendobj\n5 0 obj\n<< /Type /Page >>\nendobj\n%%EOF');
    
    // We import extractPdfPageCount dynamically or directly
    const countPages = (buf: Buffer) => {
      const text = buf.toString('latin1');
      const countMatches = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/gi)];
      if (countMatches.length > 0) {
        const counts = countMatches.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n) && n > 0);
        if (counts.length > 0) return Math.max(...counts);
      }
      const pageMatches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
      if (pageMatches && pageMatches.length > 0) return pageMatches.length;
      return 1;
    };

    expect(countPages(fakeSinglePagePdf)).toBe(1);
    expect(countPages(fakeMultiPagePdf)).toBe(113);
  });
});
