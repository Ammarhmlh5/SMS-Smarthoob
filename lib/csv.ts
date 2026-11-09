export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

export function escapeSpreadsheetCsvCell(value: string): string {
  const safeValue = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function detectDelimiter(source: string): string {
  const counts = new Map<string, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (inQuotes && source[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (character === '\n' || character === '\r')) {
      break;
    } else if (!inQuotes && counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }

  return [...counts].reduce((selected, candidate) =>
    candidate[1] > selected[1] ? candidate : selected,
  )[0];
}

export function parseCSV(content: string): ParsedCsv {
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = content.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(source);

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '"') {
      if (inQuotes && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === delimiter && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) parsedRows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('الملف يحتوي على حقل CSV غير مكتمل الاقتباس.');
  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) parsedRows.push(row);

  const headers = parsedRows.shift() ?? [];
  return { headers, rows: parsedRows };
}
