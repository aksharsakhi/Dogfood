export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
  isNumeric?: boolean;
}

/**
 * Format and escape a single CSV cell.
 * Neutralizes potential formula injection on text fields beginning with =, +, -, @, \t, or \r.
 * Numeric fields (including negative numbers) must have isNumeric: true so they are not altered.
 */
export function formatCsvCell(
  value: string | number | boolean | null | undefined,
  isNumeric?: boolean,
): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') return String(value);

  let str = String(value);

  // Formula injection defense for user-controlled text
  if (!isNumeric) {
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
  }

  // RFC 4180 quoting: escape quotes by doubling them, wrap in quotes if contains comma, quote, or newline
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize a dataset into a deterministic CSV string with UTF-8 and consistent CRLF line endings.
 */
export function generateCsv<T>(data: T[], columns: CsvColumn<T>[]): string {
  const headerRow = columns
    .map((c) => formatCsvCell(c.header, false))
    .join(',');
  const rows = data.map((row) =>
    columns.map((c) => formatCsvCell(c.accessor(row), c.isNumeric)).join(','),
  );
  return [headerRow, ...rows].join('\r\n') + '\r\n';
}
