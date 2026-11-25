import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePdfTextBounds,
  extractPdfRegionValue,
  pdfRegionFromTextBounds,
} from '../lib/pdfRegionGeometry.ts';
import { extractPdfRegionRows } from '../lib/pdfTextRows.ts';
import { isTemplateVariableMappings } from '../lib/templateMappings.ts';

test('extracts only text inside a normalized PDF region and joins words in order', () => {
  const value = extractPdfRegionValue({
    width: 100,
    height: 200,
    items: [
      { text: 'المبلغ', left: 10, top: 20, right: 28, bottom: 30 },
      { text: 'المستحق', left: 31, top: 20, right: 55, bottom: 30 },
      { text: 'تاريخ', left: 10, top: 60, right: 30, bottom: 70 },
    ],
  }, { left: 0.05, top: 0.08, right: 0.6, bottom: 0.2 });

  assert.equal(value, 'المبلغ المستحق');
});

test('uses PDF text width in page units without multiplying it by font scale again', () => {
  assert.deepEqual(calculatePdfTextBounds([10, 0, 0, -10, 20, 40], 50, 10), {
    left: 20,
    top: 30,
    right: 70,
    bottom: 40,
  });
});

test('normalized PDF regions remain aligned when a later document uses another page size', () => {
  const region = { left: 0.1, top: 0.2, right: 0.4, bottom: 0.3 };
  const value = extractPdfRegionValue({
    width: 200,
    height: 400,
    items: [
      { text: '1800.00', left: 25, top: 85, right: 60, bottom: 98 },
      { text: 'غير', left: 120, top: 85, right: 140, bottom: 98 },
    ],
  }, region);

  assert.equal(value, '1800.00');
});

test('row scope extracts one aligned value per text row within the selected column', () => {
  const rows = extractPdfRegionRows({
    pages: [
      {
        width: 100,
        height: 100,
        items: [
          { text: 'الاسم', left: 10, top: 10, right: 30, bottom: 18 },
          { text: 'المبلغ', left: 70, top: 10, right: 90, bottom: 18 },
          { text: 'عميل ١', left: 10, top: 30, right: 35, bottom: 38 },
          { text: '١٠٠', left: 70, top: 30, right: 85, bottom: 38 },
          { text: 'عميل ٢', left: 10, top: 50, right: 35, bottom: 58 },
          { text: '٢٠٠', left: 70, top: 50, right: 85, bottom: 58 },
          { text: 'الإجمالي', left: 10, top: 80, right: 40, bottom: 88 },
          { text: '٣٠٠', left: 70, top: 80, right: 85, bottom: 88 },
        ],
      },
    ],
  }, { left: 0.6, top: 0.2, right: 0.95, bottom: 0.65, scope: 'rows' });

  assert.deepEqual(rows.map(({ pageNumber, rowIndex, value }) => ({
    pageNumber,
    rowIndex,
    value,
  })), [
    { pageNumber: 1, rowIndex: 1, value: '١٠٠' },
    { pageNumber: 1, rowIndex: 2, value: '٢٠٠' },
  ]);
});

test('text-derived PDF regions stay bounded and select the chosen text item', () => {
  const page = {
    width: 100,
    height: 200,
    items: [{ text: 'رقم الفاتورة', left: 0, top: 20, right: 24, bottom: 30 }],
  };
  const region = pdfRegionFromTextBounds(page, page.items[0], 'rows');

  assert.ok(region.left >= 0 && region.top >= 0);
  assert.ok(region.right <= 1 && region.bottom <= 1);
  assert.equal(region.scope, 'rows');
  assert.ok(region.bottom - region.top < 0.1);
  assert.equal(extractPdfRegionValue(page, region), 'رقم الفاتورة');
});

test('text-derived PDF regions reject invalid page dimensions', () => {
  assert.throws(
    () => pdfRegionFromTextBounds({ width: 0, height: 100 }, {
      left: 10,
      top: 10,
      right: 20,
      bottom: 20,
    }),
    /أبعاد صفحة PDF غير صالحة/,
  );
});

test('text-derived PDF regions reject non-finite or reversed text bounds', () => {
  assert.throws(
    () => pdfRegionFromTextBounds({ width: 100, height: 100 }, {
      left: 20,
      top: 10,
      right: Number.NaN,
      bottom: 30,
    }),
    /حدود نص PDF غير صالحة/,
  );
  assert.throws(
    () => pdfRegionFromTextBounds({ width: 100, height: 100 }, {
      left: 40,
      top: 10,
      right: 20,
      bottom: 30,
    }),
    /حدود نص PDF غير صالحة/,
  );
});

test('template mappings accept columns and bounded PDF regions only', () => {
  assert.equal(isTemplateVariableMappings({
    المبلغ: { type: 'column', column: 'المبلغ المستحق' },
    العميل: {
      type: 'pdf-region',
      region: { left: 0.1, top: 0.2, right: 0.4, bottom: 0.3, scope: 'rows' },
    },
  }), true);
  assert.equal(isTemplateVariableMappings({
    المبلغ: { type: 'pdf-region', region: { left: 0.7, top: 0.2, right: 0.4, bottom: 0.3 } },
  }), false);
  assert.equal(isTemplateVariableMappings({
    المبلغ: {
      type: 'pdf-region',
      region: { left: 0.1, top: 0.2, right: 0.4, bottom: 0.3, scope: 'document' },
    },
  }), false);
});
