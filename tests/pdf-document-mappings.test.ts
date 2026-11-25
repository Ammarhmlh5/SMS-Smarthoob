import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPdfRegionMappingsToDocument } from '../lib/pdfDocumentMappings.ts';
import { buildDocumentRecipients } from '../lib/documentRecipients.ts';
import type { PdfTextDocument } from '../lib/pdfRegions.ts';
import type { DocumentAnalysis } from '../lib/documentParser.ts';

const rowRegion = (left: number, right: number) => ({
  left,
  top: 0.2,
  right,
  bottom: 0.7,
  scope: 'rows' as const,
});

const analysis: DocumentAnalysis = {
  columns: ['رقم الصفحة', 'الفترة'],
  columnInfo: {
    'رقم الصفحة': {
      name: 'رقم الصفحة',
      type: 'text',
      confidence: 1,
      sampleValues: ['1', '2'],
    },
    الفترة: {
      name: 'الفترة',
      type: 'text',
      confidence: 1,
      sampleValues: ['أكتوبر', 'نوفمبر'],
    },
  },
  rowCount: 2,
  fileName: 'sample.pdf',
  records: [
    { 'رقم الصفحة': '1', الفترة: 'أكتوبر' },
    { 'رقم الصفحة': '2', الفترة: 'نوفمبر' },
  ],
};

const textDocument: PdfTextDocument = {
  pages: [
    {
      width: 100,
      height: 100,
      items: [
        { text: 'تاريخ أ', left: 10, top: 10, right: 40, bottom: 18 },
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
    {
      width: 100,
      height: 100,
      items: [
        { text: 'تاريخ ب', left: 10, top: 10, right: 40, bottom: 18 },
        { text: 'عميل ٣', left: 10, top: 30, right: 35, bottom: 38 },
        { text: '٤٠٠', left: 70, top: 30, right: 85, bottom: 38 },
      ],
    },
  ],
};

test('row and page PDF mappings align in the same document rows', () => {
  const mapped = applyPdfRegionMappingsToDocument(analysis, textDocument, {
    customer: { type: 'pdf-region', region: rowRegion(0, 0.5) },
    amount: { type: 'pdf-region', region: rowRegion(0.6, 1) },
    period: {
      type: 'pdf-region',
      region: { left: 0, top: 0, right: 1, bottom: 0.2, scope: 'page' },
    },
  });

  assert.equal(mapped.rowCount, 3);
  assert.deepEqual(mapped.records?.map((row) => ({
    page: row['رقم الصفحة'],
    line: row['رقم السطر'],
    customer: row.__pdf_region__customer,
    amount: row.__pdf_region__amount,
    period: row.__pdf_region__period,
  })), [
    { page: '1', line: '2', customer: 'عميل ١', amount: '١٠٠', period: 'تاريخ أ الاسم المبلغ' },
    { page: '1', line: '3', customer: 'عميل ٢', amount: '٢٠٠', period: 'تاريخ أ الاسم المبلغ' },
    { page: '2', line: '2', customer: 'عميل ٣', amount: '٤٠٠', period: 'تاريخ ب' },
  ]);
});

test('row mappings repeat automatically extracted page values across rows on that page', () => {
  const mapped = applyPdfRegionMappingsToDocument(analysis, textDocument, {
    customer: { type: 'pdf-region', region: rowRegion(0, 0.5) },
    period: { type: 'column', column: 'الفترة' },
  });

  assert.equal(mapped.rowCount, 3);
  assert.ok(mapped.columns.includes('الفترة'));
  assert.deepEqual(mapped.records?.map((row) => ({
    page: row['رقم الصفحة'],
    customer: row.__pdf_region__customer,
    period: row.الفترة,
  })), [
    { page: '1', customer: 'عميل ١', period: 'أكتوبر' },
    { page: '1', customer: 'عميل ٢', period: 'أكتوبر' },
    { page: '2', customer: 'عميل ٣', period: 'نوفمبر' },
  ]);
});

test('row mappings report a missing automatic column instead of dropping it silently', () => {
  assert.throws(
    () => applyPdfRegionMappingsToDocument(analysis, textDocument, {
      customer: { type: 'pdf-region', region: rowRegion(0, 0.5) },
      period: { type: 'column', column: 'عمود غير موجود' },
    }),
    /تعذر العثور على العمود المحفوظ/,
  );
});

test('row-level phone mappings are suggested and used for every generated recipient', () => {
  const phoneTextDocument: PdfTextDocument = {
    pages: [{
      width: 100,
      height: 100,
      items: [
        { text: 'مستلم أ', left: 10, top: 30, right: 40, bottom: 38 },
        { text: '+966500000001', left: 70, top: 30, right: 98, bottom: 38 },
        { text: 'مستلم ب', left: 10, top: 50, right: 40, bottom: 58 },
        { text: '+966500000002', left: 70, top: 50, right: 98, bottom: 58 },
      ],
    }],
  };
  const mapped = applyPdfRegionMappingsToDocument(analysis, phoneTextDocument, {
    'رقم الهاتف': { type: 'pdf-region', region: rowRegion(0.6, 1) },
  });
  const recipients = buildDocumentRecipients({
    columns: mapped.columns,
    records: mapped.records ?? [],
    rowCount: mapped.rowCount,
    mapping: {},
    suggestedPhoneColumn: mapped.suggestedPhoneColumn,
    templateBody: 'رسالة اختبار',
    renderMessage: (body) => body,
  });

  assert.equal(mapped.rowCount, 2);
  assert.equal(mapped.suggestedPhoneColumn, '__pdf_region__رقم الهاتف');
  assert.deepEqual(recipients.map((recipient) => recipient.phone), [
    '+966500000001',
    '+966500000002',
  ]);
});
