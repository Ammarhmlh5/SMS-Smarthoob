import type { DocumentAnalysis } from './documentParser.ts';
import type { PdfTextDocument } from './pdfRegions.ts';
import { extractPdfRegionRows } from './pdfTextRows.ts';
import { extractPdfRegionValue } from './pdfRegionGeometry.ts';
import {
  pdfRegionColumnName,
  type TemplateVariableMappings,
} from './templateMappings.ts';

export function applyPdfRegionMappingsToDocument(
  analysis: DocumentAnalysis,
  textDocument: PdfTextDocument,
  mappings: TemplateVariableMappings,
): DocumentAnalysis {
  const regionMappings = Object.entries(mappings).filter(
    (entry): entry is [string, Extract<TemplateVariableMappings[string], { type: 'pdf-region' }>] =>
      entry[1].type === 'pdf-region',
  );
  const rowMappings = regionMappings.filter(([, mapping]) => mapping.region.scope === 'rows');
  const pageMappings = regionMappings.filter(([, mapping]) => mapping.region.scope !== 'rows');
  const columnMappings = Object.entries(mappings).filter(
    (entry): entry is [string, Extract<TemplateVariableMappings[string], { type: 'column' }>] =>
      entry[1].type === 'column',
  );

  if (rowMappings.length > 0) {
    return applyRowMappings(analysis, textDocument, rowMappings, pageMappings, columnMappings);
  }

  return applyPageMappings(analysis, textDocument, pageMappings);
}

function applyPageMappings(
  analysis: DocumentAnalysis,
  textDocument: PdfTextDocument,
  mappings: Array<[string, Extract<TemplateVariableMappings[string], { type: 'pdf-region' }>]>,
): DocumentAnalysis {
  if (mappings.length === 0) return analysis;

  const records = new Map(
    (analysis.records ?? []).map((record) => [Number(record['رقم الصفحة']), { ...record }]),
  );
  const columns = [...analysis.columns];
  const columnInfo = { ...analysis.columnInfo };

  for (const [variable, mapping] of mappings) {
    const values = getRegionValues(textDocument, mapping.region);
    if (!values.some((value) => value.trim())) {
      throw new Error(`تعذر استخراج المنطقة المحفوظة للمتغير {{${variable}}} من هذا الملف.`);
    }

    const column = pdfRegionColumnName(variable);
    columns.push(column);
    columnInfo[column] = {
      name: column,
      type: 'text',
      confidence: 1,
      sampleValues: values.filter(Boolean).slice(0, 5),
    };

    values.forEach((value, pageIndex) => {
      if (!value.trim()) return;
      const pageNumber = pageIndex + 1;
      const record = records.get(pageNumber) ?? { 'رقم الصفحة': String(pageNumber) };
      record[column] = value;
      records.set(pageNumber, record);
    });
  }

  const mergedRecords = [...records.values()].sort(
    (a, b) => Number(a['رقم الصفحة']) - Number(b['رقم الصفحة']),
  );
  return {
    ...analysis,
    columns,
    columnInfo,
    records: mergedRecords,
    rowCount: mergedRecords.length,
  };
}

function applyRowMappings(
  analysis: DocumentAnalysis,
  textDocument: PdfTextDocument,
  rowMappings: Array<[string, Extract<TemplateVariableMappings[string], { type: 'pdf-region' }>]>,
  pageMappings: Array<[string, Extract<TemplateVariableMappings[string], { type: 'pdf-region' }>]>,
  columnMappings: Array<[string, Extract<TemplateVariableMappings[string], { type: 'column' }>]>,
): DocumentAnalysis {
  const records = new Map<string, Record<string, string>>();
  const columns: string[] = [];
  const columnInfo: DocumentAnalysis['columnInfo'] = {};
  const pageRecords = new Map(
    (analysis.records ?? []).map((record) => [Number(record['رقم الصفحة']), record]),
  );

  for (const [variable, mapping] of rowMappings) {
    const column = pdfRegionColumnName(variable);
    columns.push(column);
    const rowValues = extractPdfRegionRows(textDocument, mapping.region);
    if (!rowValues.some((row) => row.value.trim())) {
      throw new Error(`تعذر استخراج قيم الصفوف للمتغير {{${variable}}} من هذا الملف.`);
    }
    columnInfo[column] = {
      name: column,
      type: 'text',
      confidence: 1,
      sampleValues: rowValues.map((row) => row.value).filter(Boolean).slice(0, 5),
    };

    for (const rowValue of rowValues) {
      const key = `${rowValue.pageNumber}:${rowValue.rowIndex}`;
      const record = records.get(key) ?? {
        'رقم الصفحة': String(rowValue.pageNumber),
        'رقم السطر': String(rowValue.rowIndex + 1),
        'النص المستخرج': rowValue.rowText,
      };
      record[column] = rowValue.value;
      records.set(key, record);
    }
  }

  for (const [variable, mapping] of pageMappings) {
    const column = pdfRegionColumnName(variable);
    columns.push(column);
    const values = getRegionValues(textDocument, mapping.region);
    columnInfo[column] = {
      name: column,
      type: 'text',
      confidence: 1,
      sampleValues: values.filter(Boolean).slice(0, 5),
    };
    for (const record of records.values()) {
      record[column] = values[Number(record['رقم الصفحة']) - 1] ?? '';
    }
  }

  for (const [, mapping] of columnMappings) {
    const info = analysis.columnInfo[mapping.column];
    if (!analysis.columns.includes(mapping.column) || !info) {
      throw new Error(`تعذر العثور على العمود المحفوظ "${mapping.column}" في تحليل ملف PDF.`);
    }
    if (!columns.includes(mapping.column)) columns.push(mapping.column);
    columnInfo[mapping.column] = info;
  }

  for (const record of records.values()) {
    const pageRecord = pageRecords.get(Number(record['رقم الصفحة']));
    for (const [, mapping] of columnMappings) {
      record[mapping.column] = pageRecord?.[mapping.column] ?? '';
    }
  }

  const mergedRecords = [...records.values()]
    .filter((record) =>
      rowMappings.some(([variable]) => Boolean(record[pdfRegionColumnName(variable)]?.trim())),
    )
    .sort((a, b) =>
      Number(a['رقم الصفحة']) - Number(b['رقم الصفحة']) ||
      Number(a['رقم السطر']) - Number(b['رقم السطر']),
    );
  const phoneVariable = rowMappings
    .map(([variable]) => variable)
    .find((variable) => /هاتف|جوال|phone|mobile/i.test(variable));
  const nameVariable = rowMappings
    .map(([variable]) => variable)
    .find((variable) => /اسم|name|عميل|مشترك/i.test(variable));
  const suggestedPhoneColumn = phoneVariable
    ? pdfRegionColumnName(phoneVariable)
    : columnMappings.find(([, mapping]) => /هاتف|جوال|phone|mobile|واتساب/i.test(mapping.column))?.[1].column
      ?? (analysis.suggestedPhoneColumn && columnMappings.some(
        ([, mapping]) => mapping.column === analysis.suggestedPhoneColumn,
      )
        ? analysis.suggestedPhoneColumn
        : undefined);
  const suggestedNameColumn = nameVariable
    ? pdfRegionColumnName(nameVariable)
    : columnMappings.find(([, mapping]) => /اسم|name|عميل|مشترك/i.test(mapping.column))?.[1].column
      ?? (analysis.suggestedNameColumn && columnMappings.some(
        ([, mapping]) => mapping.column === analysis.suggestedNameColumn,
      )
        ? analysis.suggestedNameColumn
        : undefined);

  return {
    columns,
    columnInfo,
    rowCount: mergedRecords.length,
    fileName: analysis.fileName,
    records: mergedRecords,
    suggestedPhoneColumn,
    suggestedNameColumn,
  };
}

function getRegionValues(
  textDocument: PdfTextDocument,
  region: Extract<TemplateVariableMappings[string], { type: 'pdf-region' }>['region'],
): string[] {
  if (region.scope === 'rows') {
    return extractPdfRegionRows(textDocument, region).map((row) => row.value);
  }
  return textDocument.pages.map((page) => extractPdfRegionValue(page, region));
}
