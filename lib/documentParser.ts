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
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/comma-separated-values'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: asset.name,
    };
  } catch (error) {
    console.error('Error picking document:', error);
    throw new Error('تعذر اختيار الملف');
  }
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
    const cleanValue = value.replace(/[\s-]/g, '');
    if (PHONE_PATTERNS.some(p => p.test(cleanValue))) phoneCount++;
    if (EMAIL_PATTERN.test(value)) emailCount++;
    
    const numValue = value.replace(/[.,ريال٠-٩$]/g, '').trim();
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
    const content = await FileSystem.readAsStringAsync(uri);
    const { headers, rows } = parseCSV(content);
    
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

    return {
      columns: headers,
      columnInfo,
      rowCount: rows.length,
      fileName,
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
        'الجوال': ['phone', 'text'],
        'الهاتف': ['phone', 'text'],
        'المبلغ': ['amount'],
        'التاريخ': ['date'],
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