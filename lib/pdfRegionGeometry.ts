import type { PdfRegion } from './templateMappings.ts';
import type { PdfTextPage } from './pdfRegions.ts';

export type PdfTextBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function pdfRegionFromTextBounds(
  page: Pick<PdfTextPage, 'width' | 'height'>,
  bounds: PdfTextBounds,
  scope: 'page' | 'rows' = 'page',
): PdfRegion {
  if (!Number.isFinite(page.width) || page.width <= 0 ||
      !Number.isFinite(page.height) || page.height <= 0) {
    throw new Error('أبعاد صفحة PDF غير صالحة.');
  }
  if (
    ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
    bounds.right < bounds.left ||
    bounds.bottom < bounds.top
  ) {
    throw new Error('حدود نص PDF غير صالحة.');
  }

  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const width = Math.min(page.width, Math.max((bounds.right - bounds.left) * 1.2, page.width * 0.025));
  const height = Math.min(page.height, Math.max((bounds.bottom - bounds.top) * 1.2, page.height * 0.012));
  const left = Math.max(0, Math.min(page.width - width, centerX - width / 2));
  const top = Math.max(0, Math.min(page.height - height, centerY - height / 2));

  return {
    left: left / page.width,
    top: top / page.height,
    right: (left + width) / page.width,
    bottom: (top + height) / page.height,
    scope,
  };
}

export function calculatePdfTextBounds(
  transform: readonly number[],
  width: number,
  height: number,
): PdfTextBounds {
  const horizontalLength = Math.hypot(transform[0], transform[1]) || 1;
  const verticalLength = Math.hypot(transform[2], transform[3]) || 1;
  const textHeight = height > 0 ? height : verticalLength;
  const corners = [
    [transform[4], transform[5]],
    [
      transform[4] + (transform[0] / horizontalLength) * width,
      transform[5] + (transform[1] / horizontalLength) * width,
    ],
    [
      transform[4] + (transform[2] / verticalLength) * textHeight,
      transform[5] + (transform[3] / verticalLength) * textHeight,
    ],
    [
      transform[4] + (transform[0] / horizontalLength) * width + (transform[2] / verticalLength) * textHeight,
      transform[5] + (transform[1] / horizontalLength) * width + (transform[3] / verticalLength) * textHeight,
    ],
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function extractPdfRegionValue(page: PdfTextPage, region: PdfRegion): string {
  const left = region.left * page.width;
  const right = region.right * page.width;
  const top = region.top * page.height;
  const bottom = region.bottom * page.height;
  const selected = page.items
    .filter((item) => {
      const centerX = (item.left + item.right) / 2;
      const centerY = (item.top + item.bottom) / 2;
      return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
    })
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: { y: number; values: string[] }[] = [];
  for (const item of selected) {
    const y = (item.top + item.bottom) / 2;
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (line) line.values.push(item.text);
    else lines.push({ y, values: [item.text] });
  }

  return lines
    .sort((a, b) => a.y - b.y)
    .map((line) => line.values.join(' '))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}
