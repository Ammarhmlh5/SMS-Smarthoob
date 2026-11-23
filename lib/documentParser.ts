/**
 * Document Parser - Handles CSV/Excel file parsing for template variable mapping
 * Uses expo-document-picker for native file selection
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import bidiFactory from 'bidi-js';
import { parseCSV } from '@/lib/csv';

const bidi = bidiFactory();

const ARABIC_PRESENTATION_FORM =
  /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function normalizeArabicDocumentText(value: string): string {
  if (!value) return '';

  const hadArabicPresentationForms = ARABIC_PRESENTATION_FORM.test(value);
  let normalized = value.normalize('NFKC');

  // PDF engines can extract Arabic in visual/presentation-form order.
  // Restore logical text order before bidi-js calculates the display levels.
  if (hadArabicPresentationForms) {
    normalized = [...normalized].reverse().join('');
  }

  if (/[\u0600-\u06FF]/.test(normalized)) {
    const embeddingLevels = bidi.getEmbeddingLevels(normalized, 'rtl');
    if (embeddingLevels.levels.length > 0) {
      return normalized.normalize('NFC').trim();
    }
  }

  return normalized.normalize('NFC').trim();
}

export type ColumnInfo = {
  name: string;
  type: 'phone' | 'name' | 'email' | 'amount' | 'date' | 'text' | 'unknown';
  confidence: number;
  sampleValues: string[];
};

export type DocumentAnalysis = {
  columns: string[];
  columnInfo: Record<string, ColumnInfo>;
  rowCount: number;
  fileName: string;
  records?: Record<string, string>[];
  suggestedPhoneColumn?: string;
  suggestedNameColumn?: string;
};

export type VariableMapping = {
  variable: string;
  column: string;
  confidence: number;
};

// =====================
// Document Picker
// =====================

export type PickedDocument = {
  uri: string;
  name: string;
  mimeType?: string;
  file?: File;
};

export async function pickDocument(): Promise<PickedDocument | null> {
  try {
    // Try native picker first - supports CSV, Excel, and PDF
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        '*/*',
        'application/pdf',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
      copyToCacheDirectory: true,
    });

    console.log('Document picker result:', JSON.stringify(result, null, 2));

    if (result.canceled) {
      console.log('Picker canceled');
      return null;
    }

    if (!result.assets || result.assets.length === 0) {
      console.log('No assets selected');
      return null;
    }

    const asset = result.assets[0];
    console.log('Selected file:', asset.name, asset.uri);
    
    if (!asset.uri) {
      throw new Error('لم يتم الحصول على رابط الملف');
    }
    
    const browserFile = typeof window !== 'undefined'
      ? (asset as { file?: File }).file
      : undefined;

    return {
      uri: asset.uri,
      name: asset.name || 'document',
      mimeType: asset.mimeType,
      file: browserFile instanceof File ? browserFile : undefined,
    };
  } catch (error) {
    console.error('Error picking document:', error);
    // Try web fallback
    if (typeof window !== 'undefined') {
      return pickDocumentWeb();
    }
    throw new Error('تعذر اختيار الملف: ' + (error as Error).message);
  }
}

// Web fallback using browser file input
async function pickDocumentWeb(): Promise<PickedDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls,.pdf,application/pdf';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            uri: reader.result as string,
            name: file.name,
            mimeType: file.type,
            file,
          });
        };
        reader.onerror = () => {
          resolve(null);
        };
        reader.readAsDataURL(file);
      } else {
        resolve(null);
      }
    };
    
    input.onerror = () => resolve(null);
    input.click();
  });
}

export async function pickedDocumentToUploadFile(
  document: PickedDocument,
  fallbackMimeType: string,
): Promise<File | { uri: string; name: string; type: string }> {
  if (typeof window !== 'undefined' && typeof File !== 'undefined') {
    if (document.file instanceof File) {
      return document.file;
    }

    if (/^(data|blob|https?):/.test(document.uri)) {
      const response = await fetch(document.uri);
      if (!response.ok) {
        throw new Error('تعذر قراءة الملف المختار.');
      }
      const blob = await response.blob();
      return new File([blob], document.name, {
        type: document.mimeType || blob.type || fallbackMimeType,
      });
    }
  }

  return {
    uri: document.uri,
    name: document.name,
    type: document.mimeType || fallbackMimeType,
  };
}

// =====================
// Column Analysis
// =====================

/**
 * تحويل الأرقام العربية المشرقية (٠١٢٣٤٥٦٧٨٩) إلى أرقام لاتينية (0123456789)
 */
export function normalizeArabicDigits(str: string): string {
  if (!str) return '';
  return str.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

/**
 * تطبيع وتنسيق رقم الهاتف الدولي
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  let clean = normalizeArabicDigits(phone).replace(/[\s-]/g, '');
  if (clean.startsWith('00')) {
    clean = '+' + clean.substring(2);
  }
  return clean;
}

const PHONE_PATTERNS = [
  /^\+?[0-9]{7,15}$/,
  /^00[0-9]{7,15}$/,
  /^0[0-9]{7,12}$/,
  /^966[0-9]{9}$/,
];

const EMAIL_PATTERN = /^[\w.-]+@[\w.-]+\.\w+$/;

function analyzeColumn(name: string, values: string[]): ColumnInfo {
  const samples = values.slice(0, 10).filter(v => v && v.trim());
  
  if (samples.length === 0) {
    return { name, type: 'unknown', confidence: 0, sampleValues: [] };
  }

  let phoneCount = 0;
  let emailCount = 0;
  let numberCount = 0;
  let nameIndicators = 0;

  for (const value of samples) {
    const cleanValue = normalizePhoneNumber(value);
    if (PHONE_PATTERNS.some((p) => p.test(cleanValue))) phoneCount++;
    if (EMAIL_PATTERN.test(value)) emailCount++;

    const numValue = normalizeArabicDigits(value).replace(/[.,ريال$]/g, '').trim();
    if (/^\d+(\.\d+)?$/.test(numValue)) numberCount++;
    
    const lowerName = name.toLowerCase();
    const arabicNameIndicators = ['الاسم', 'اسم', 'مشتري', 'عميل', 'زبون', 'customer', 'client', 'name'];
    if (arabicNameIndicators.some(ind => lowerName.includes(ind))) {
      nameIndicators++;
    }
  }

  const count = samples.length;
  const nameLower = name.toLowerCase();

  let type: ColumnInfo['type'] = 'text';
  let confidence = 0.3;

  if (phoneCount / count >= 0.5) {
    type = 'phone';
    confidence = phoneCount / count;
  } else if (emailCount / count >= 0.5) {
    type = 'email';
    confidence = emailCount / count;
  } else if (nameIndicators > 0 || nameLower.includes('name') || nameLower.includes('الاسم')) {
    type = 'name';
    confidence = 0.8;
  } else if (numberCount / count >= 0.5) {
    if (nameLower.includes('amount') || nameLower.includes('المبلغ') || nameLower.includes('سعر') || nameLower.includes('total')) {
      type = 'amount';
    } else if (nameLower.includes('date') || nameLower.includes('التاريخ')) {
      type = 'date';
    }
    confidence = numberCount / count;
  }

  return {
    name,
    type,
    confidence,
    sampleValues: samples.slice(0, 5),
  };
}

// =====================
// Main Parse Function
// =====================

export async function parseDocumentFile(uri: string, fileName: string): Promise<DocumentAnalysis> {
  try {
    console.log('parseDocumentFile called with:', uri, fileName);
    
    let content: string;
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      if (!response.ok) throw new Error('تعذر قراءة الملف المختار.');
      content = await response.text();
    } else {
      content = await FileSystem.readAsStringAsync(uri);
      console.log('Read file from filesystem, length:', content.length);
    }
    
    const { headers, rows } = parseCSV(content);
    console.log('CSV parsed - headers:', headers, 'rows:', rows.length);

    if (headers.length === 0) {
      throw new Error('الملف فارغ أو غير صالح');
    }
    if (rows.some((row) => row.length !== headers.length)) {
      throw new Error('بعض صفوف CSV لا تطابق عدد الأعمدة في رأس الملف.');
    }

    const columnInfo: Record<string, ColumnInfo> = {};
    
    for (const header of headers) {
      const values = rows.map(row => {
        const index = headers.indexOf(header);
        return row[index] || '';
      });
      columnInfo[header] = analyzeColumn(header, values);
    }

    const records = rows.map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((h, i) => {
        record[h] = row[i] || '';
      });
      return record;
    });

    let suggestedPhoneColumn: string | undefined;
    let suggestedNameColumn: string | undefined;

    for (const header of headers) {
      if (columnInfo[header]?.type === 'phone' && !suggestedPhoneColumn) {
        suggestedPhoneColumn = header;
      }
      if (columnInfo[header]?.type === 'name' && !suggestedNameColumn) {
        suggestedNameColumn = header;
      }
    }

    return {
      columns: headers,
      columnInfo,
      rowCount: rows.length,
      fileName,
      records,
      suggestedPhoneColumn,
      suggestedNameColumn,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('تعذر تحليل الملف');
  }
}

// =====================
// Variable Mapping
// =====================

export function suggestMapping(
  variables: string[],
  columns: string[],
  columnInfo: Record<string, ColumnInfo>
): VariableMapping[] {
  const mappings: VariableMapping[] = [];

  for (const variable of variables) {
    const varLower = variable.toLowerCase().replace(/[_\s]/g, '');
    
    let bestMatch = '';
    let bestConfidence = 0;

    for (const column of columns) {
      const colLower = column.toLowerCase().replace(/[_\s]/g, '');
      const info = columnInfo[column];
      
      if (varLower === colLower) {
        bestMatch = column;
        bestConfidence = 1;
        break;
      }
      
      if (varLower.includes(colLower) || colLower.includes(varLower)) {
        if (info.confidence > bestConfidence) {
          bestMatch = column;
          bestConfidence = info.confidence;
        }
      }
      
      const expectedTypes: Record<string, ColumnInfo['type'][]> = {
        'name': ['name', 'text'],
        'phone': ['phone', 'text'],
        'mobile': ['phone', 'text'],
        'email': ['email'],
        'amount': ['amount'],
        'total': ['amount'],
        'price': ['amount'],
        'date': ['date'],
        'الاسم': ['name', 'text'],
        'العميل': ['name', 'text'],
        'المشترك': ['name', 'text'],
        'الجوال': ['phone', 'text'],
        'الهاتف': ['phone', 'text'],
        'رقم_الجوال': ['phone', 'text'],
        'رقم_الهاتف': ['phone', 'text'],
        'المبلغ': ['amount'],
        'السعر': ['amount'],
        'القيمة': ['amount'],
        'التاريخ': ['date'],
        'تاريخ_الاستحقاق': ['date', 'text'],
        'الوقت': ['date', 'text'],
        'رقم_الطلب': ['text', 'amount'],
        'رقم_الفاتورة': ['text', 'amount'],
        'رقم_التتبع': ['text'],
      };

      const types = expectedTypes[variable] || expectedTypes[varLower] || [];
      if (types.includes(info.type) && info.confidence > bestConfidence) {
        bestMatch = column;
        bestConfidence = info.confidence * 0.8;
      }
    }

    if (bestMatch) {
      mappings.push({
        variable,
        column: bestMatch,
        confidence: bestConfidence,
      });
    }
  }

  return mappings;
}

// =====================
// Sample Data
// =====================

export function getSampleRecords(columns: string[], columnInfo: Record<string, ColumnInfo>, count: number = 3): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  
  for (let i = 0; i < count; i++) {
    const record: Record<string, string> = {};
    
    for (const column of columns) {
      const info = columnInfo[column];
      switch (info.type) {
        case 'phone':
          record[column] = `96655${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
          break;
        case 'name':
          record[column] = ['أحمد محمد', 'خالد علي', 'سارة أحمد'][i % 3];
          break;
        case 'email':
          record[column] = `user${i + 1}@example.com`;
          break;
        case 'amount':
          record[column] = `${(Math.random() * 1000).toFixed(2)}`;
          break;
        case 'date':
          record[column] = new Date(Date.now() + i * 86400000).toISOString().split('T')[0];
          break;
        default:
          record[column] = `قيمة ${i + 1}`;
      }
    }
    
    records.push(record);
  }
  
  return records;
}