import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { PdfRegion } from '@/lib/templateMappings';
import { calculatePdfTextBounds, extractPdfRegionValue } from '@/lib/pdfRegionGeometry';
import { extractPdfRegionRows } from './pdfTextRows';

export { extractPdfRegionRows } from './pdfTextRows';
export type { PdfRegionRowValue, PdfTextRow } from './pdfTextRows';

export type PdfTextItem = {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PdfTextPage = {
  width: number;
  height: number;
  items: PdfTextItem[];
};

export type PdfTextDocument = {
  pages: PdfTextPage[];
};

async function readPdfData(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('تعذر قراءة ملف PDF المختار.');
    return new Uint8Array(await response.arrayBuffer());
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = globalThis.atob(base64);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  return data;
}

export async function loadPdfTextDocument(uri: string): Promise<PdfTextDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  }

  const pdf = await pdfjs.getDocument({ data: await readPdfData(uri) }).promise;
  const pages: PdfTextPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];

    for (const item of content.items) {
      if (!('str' in item) || !('transform' in item) || !item.str.trim()) continue;
      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      items.push({
        text: item.str.trim(),
        ...calculatePdfTextBounds(transform, item.width ?? 0, item.height ?? 0),
      });
    }

    pages.push({ width: viewport.width, height: viewport.height, items });
  }

  return { pages };
}

export function extractPdfRegionValues(
  document: PdfTextDocument,
  region: PdfRegion,
): string[] {
  if (region.scope === 'rows') {
    return extractPdfRegionRows(document, region).map((row) => row.value);
  }
  return document.pages.map((page) => extractPdfRegionValue(page, region));
}
