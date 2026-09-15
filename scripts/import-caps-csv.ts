/**
 * Bulk-import CAPS topics from a CSV file.
 *
 * Run: node_modules/.bin/tsx scripts/import-caps-csv.ts [path-to.csv]
 * Default file: data/caps-import.csv
 *
 * The CSV needs a header row with these columns (order does not matter):
 *   Subject, Grade, Topic title, CAPS code
 *
 * Patrick supplies the content; this only moves it into the database. It invents
 * nothing, and it reports every row it could not use, with the reason — a bad row
 * is never silently dropped. Re-running the same file updates rather than
 * duplicates.
 *
 * Excel and Google Sheets both save as CSV: File -> Save As -> CSV.
 *
 * See dev-library/requirements-caps-import.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { importTopics, type ImportTopic } from '../lib/caps/curriculum';

interface ParsedRow {
  cells: string[];
  line: number;
}

/**
 * Minimal RFC-4180 CSV reader: handles quoted fields, commas inside quotes, and
 * doubled quotes. Written here rather than adding a dependency.
 */
function parseCsv(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  // Strip a UTF-8 BOM, which Excel adds and which would corrupt the first header.
  const input = text.replace(/^\uFEFF/, '');

  const pushField = () => {
    cells.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip wholly blank lines.
    if (cells.some((cell) => cell.trim() !== '')) {
      rows.push({ cells, line: rowStartLine });
    }
    cells = [];
    rowStartLine = line;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\r') {
      // ignore; handled with \n
    } else if (char === '\n') {
      pushRow();
      line += 1;
      rowStartLine = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || cells.length > 0) pushRow();

  return rows;
}

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  const fileArg = process.argv[2] ?? path.join('data', 'caps-import.csv');
  const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);

  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch {
    console.error(`Could not read ${filePath}`);
    console.error('Put the CSV there, or pass a path: tsx scripts/import-caps-csv.ts my-file.csv');
    process.exit(1);
    return;
  }

  const rows = parseCsv(text);
  if (rows.length === 0) {
    console.error('The file is empty.');
    process.exit(1);
    return;
  }

  const header = rows[0].cells.map(normaliseHeader);
  const columnIndex = (...names: string[]) => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };

  const subjectCol = columnIndex('subject');
  const gradeCol = columnIndex('grade');
  const titleCol = columnIndex('topic title', 'topic', 'title');
  const codeCol = columnIndex('caps code', 'caps', 'code');

  const missing: string[] = [];
  if (subjectCol === -1) missing.push('Subject');
  if (gradeCol === -1) missing.push('Grade');
  if (titleCol === -1) missing.push('Topic title');
  if (missing.length > 0) {
    console.error(`The header row is missing these columns: ${missing.join(', ')}`);
    console.error(`Found instead: ${rows[0].cells.join(' | ')}`);
    console.error('Expected header: Subject, Grade, Topic title, CAPS code');
    process.exit(1);
    return;
  }

  console.log(`Reading ${filePath}`);
  console.log(`Header: ${rows[0].cells.join(' | ')}`);
  if (codeCol === -1) {
    console.log('Note: no "CAPS code" column found, so every topic will load with no CAPS code.');
  }

  const valid: Array<ImportTopic & { line: number }> = [];
  const rejected: Array<{ row: number; reason: string }> = [];

  for (const row of rows.slice(1)) {
    const cell = (index: number) => (index === -1 ? '' : (row.cells[index] ?? ''));
    const subject = cell(subjectCol).trim();
    const title = cell(titleCol).trim();
    const rawGrade = cell(gradeCol).trim();
    const capsCode = cell(codeCol).trim();

    if (!subject) {
      rejected.push({ row: row.line, reason: 'Subject is blank' });
      continue;
    }
    if (!title) {
      rejected.push({ row: row.line, reason: 'Topic title is blank' });
      continue;
    }
    if (!rawGrade) {
      rejected.push({ row: row.line, reason: 'Grade is blank' });
      continue;
    }
    const grade = Number(rawGrade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 12) {
      rejected.push({ row: row.line, reason: `"${rawGrade}" is not a school grade between 1 and 12` });
      continue;
    }

    valid.push({ subject, grade, title, capsCode, line: row.line });
  }

  console.log(`\nRows read: ${rows.length - 1} | usable: ${valid.length} | refused: ${rejected.length}`);
  if (valid.length === 0) {
    console.log('\nNothing to import.');
  } else {
    const outcome = await importTopics(valid.map(({ line, ...topic }) => topic));

    console.log('\n--- what happened ---');
    console.log(`  Topics added:   ${outcome.added}`);
    console.log(`  Topics updated: ${outcome.updated}`);
    if (outcome.subjectsCreated.length > 0) {
      console.log(`  Subjects created: ${outcome.subjectsCreated.join(', ')}`);
    }
  }

  if (rejected.length > 0) {
    console.log('\n--- rows refused (nothing was saved for these) ---');
    for (const item of rejected) {
      console.log(`  line ${item.row}: ${item.reason}`);
    }
  }

  console.log('\nDone. Open /admin to check the result.');
  process.exit(rejected.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
