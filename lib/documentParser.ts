/**
 * Document Parser - Handles CSV/Excel file parsing for template variable mapping
 * Uses expo-document-picker for native file selection
 */

import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

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

export async function pickDocument(): Promise<{ uri: string; name: string } | null> {
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
    
    return {
      uri: asset.uri,
      name: asset.name || 'document',
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
async function pickDocumentWeb(): Promise<{ uri: string; name: string } | null> {
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

// =====================
// Simple CSV Parser
// =====================

function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);

  return { headers, rows };
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
    
    // Check if it's a data URL (web) or file URI (native)
    if (uri.startsWith('data:')) {
      // Web: Extract content from data URL
      const base64 = uri.split(',')[1];
      content = atob(base64);
      console.log('Parsed web data URL');
    } else {
      // Native: Read from file system
      content = await FileSystem.readAsStringAsync(uri);
      console.log('Read file from filesystem, length:', content.length);
    }
    
    const { headers, rows } = parseCSV(content);
    console.log('CSV parsed - headers:', headers, 'rows:', rows.length);
    
    if (headers.length === 0) {
      throw new Error('الملف فارغ أو غير صالح');
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