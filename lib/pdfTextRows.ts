import type { PdfRegion } from './templateMappings.ts';
import type { PdfTextDocument, PdfTextItem, PdfTextPage } from './pdfRegions.ts';

export type PdfTextRow = {
  index: number;
  centerY: number;
  top: number;
  bottom: number;
  items: PdfTextItem[];
};

export type PdfRegionRowValue = {
  pageNumber: number;
  rowIndex: number;
  rowText: string;
  value: string;
};

export function groupPdfTextItemsByRow(page: PdfTextPage): PdfTextRow[] {
  const sortedItems = [...page.items].sort((a, b) => {
    const centerDifference = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2;
    return centerDifference || a.left - b.left;
  });
  const rows: Omit<PdfTextRow, 'index'>[] = [];

  for (const item of sortedItems) {
    const centerY = (item.top + item.bottom) / 2;
    let row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) <= 3);
    if (!row) {
      row = { centerY, top: item.top, bottom: item.bottom, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.top = Math.min(row.top, item.top);
    row.bottom = Math.max(row.bottom, item.bottom);
    row.centerY = row.items.reduce(
      (total, current) => total + (current.top + current.bottom) / 2,
      0,
    ) / row.items.length;
  }

  return rows
    .sort((a, b) => a.centerY - b.centerY)
    .map((row, index) => ({
      ...row,
      index,
      items: row.items.sort((a, b) => a.left - b.left),
    }));
}

export function extractPdfRegionRows(
  document: PdfTextDocument,
  region: PdfRegion,
): PdfRegionRowValue[] {
  return document.pages.flatMap((page, pageIndex) => {
    const top = region.top * page.height;
    const bottom = region.bottom * page.height;
    const left = region.left * page.width;
    const right = region.right * page.width;

    return groupPdfTextItemsByRow(page)
      .filter((row) => row.centerY >= top && row.centerY <= bottom)
      .map((row) => ({
        pageNumber: pageIndex + 1,
        rowIndex: row.index,
        rowText: row.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
        value: row.items
          .filter((item) => {
            const centerX = (item.left + item.right) / 2;
            return centerX >= left && centerX <= right;
          })
          .map((item) => item.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      }));
  });
}
