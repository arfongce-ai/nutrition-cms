import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';

const downloadsDir = path.join(os.homedir(), 'Downloads');
const defaultInputs = [
  {
    file: path.join(downloadsDir, '20260604_가공식품_293506건.xlsx'),
    sourceFile: '20260604_가공식품_293506건.xlsx',
    dbType: '가공식품',
    versionDate: '2026-06-04',
  },
  {
    file: path.join(downloadsDir, '20260626_가공식품DB_298288건.xlsx'),
    sourceFile: '20260626_가공식품DB_298288건.xlsx',
    dbType: '가공식품',
    versionDate: '2026-06-26',
  },
  {
    file: path.join(downloadsDir, '20260623_건강기능식품DB_5556건 (3).xlsx'),
    sourceFile: '20260623_건강기능식품DB_5556건 (3).xlsx',
    dbType: '건강기능식품',
    versionDate: '2026-06-23',
  },
  {
    file: path.join(downloadsDir, '20251229_음식DB 19495건.xlsx'),
    sourceFile: '20251229_음식DB 19495건.xlsx',
    dbType: '음식',
    versionDate: '2025-12-29',
  },
];

const outputDir = path.join('data', 'imported', 'public-foods-d1');
const insertColumns = [
  'food_code',
  'db_type',
  'food_name',
  'search_name',
  'data_group',
  'origin_name',
  'category_large',
  'category_middle',
  'category_small',
  'category_detail',
  'representative_food',
  'serving_basis',
  'serving_weight',
  'calories_kcal',
  'carbohydrates_g',
  'protein_g',
  'fat_g',
  'saturated_fat_g',
  'trans_fat_g',
  'sugar_g',
  'sodium_mg',
  'fiber_g',
  'leucine_mg',
  'caffeine_mg',
  'manufacturer_name',
  'importer_name',
  'distributor_name',
  'report_no',
  'source_name',
  'source_file',
  'standard_date',
  'updated_at',
];

const updateColumns = insertColumns.filter((column) => column !== 'food_code');

const args = parseArgs(process.argv.slice(2));
const rowLimit = Number(args.limit || 0);
const rowsPerChunk = Math.max(1000, Number(args.chunkSize || 10000));
const selectedInputs = args.input
  ? [
      {
        file: path.resolve(args.input),
        sourceFile: path.basename(args.input),
        dbType: args.type || '공공식품',
        versionDate: args.versionDate || '',
      },
    ]
  : defaultInputs;

const existingInputs = [];
for (const input of selectedInputs) {
  if (await exists(input.file)) existingInputs.push(input);
}

if (!existingInputs.length) {
  console.error('가져올 XLSX 파일을 찾지 못했습니다.');
  process.exit(1);
}

await resetOutputDir(outputDir);

const manifest = {
  generatedAt: new Date().toISOString(),
  outputDir,
  rowsPerChunk,
  files: [],
  totalRows: 0,
  chunks: [],
};

let writer = null;
let chunkIndex = 0;
let chunkRows = 0;

for (const input of existingInputs) {
  const fileSummary = await importWorkbook(input);
  manifest.files.push(fileSummary);
  manifest.totalRows += fileSummary.rows;
}

if (writer) {
  await closeWriter(writer);
}

await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      outputDir,
      totalRows: manifest.totalRows,
      chunks: manifest.chunks.length,
      files: manifest.files,
    },
    null,
    2,
  ),
);

async function importWorkbook(input) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(input.file, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
    hyperlinks: 'ignore',
    styles: 'ignore',
  });
  const summary = {
    sourceFile: input.sourceFile,
    dbType: input.dbType,
    rows: 0,
    skipped: 0,
    sheetNames: [],
  };

  for await (const worksheet of workbook) {
    summary.sheetNames.push(worksheet.name);
    let headerMap = null;

    for await (const row of worksheet) {
      const values = row.values.slice(1);
      if (!headerMap) {
        headerMap = createHeaderMap(values);
        continue;
      }

      if (rowLimit && manifest.totalRows + summary.rows >= rowLimit) break;

      const record = createRecord(values, headerMap, input);
      if (!record) {
        summary.skipped += 1;
        continue;
      }

      if (!writer || chunkRows >= rowsPerChunk) {
        if (writer) await closeWriter(writer);
        writer = await openWriter();
        chunkRows = 0;
      }

      await writer.handle.write(`${createInsertSql(record)}\n`);
      summary.rows += 1;
      chunkRows += 1;
    }
  }

  return summary;
}

function createRecord(values, headerMap, input) {
  const value = (headers) => pickValue(values, headerMap, headers);
  const foodCode = cleanText(value(['식품코드']));
  const foodName = cleanFoodName(value(['식품명']));
  if (!foodCode || !foodName) return null;

  const sourceName = cleanText(value(['출처명']));
  const standardDate = normalizeDate(value(['데이터기준일자'])) || input.versionDate;
  const servingBasis = cleanText(value(['영양성분함량기준량', '영양성분제공단위량']));
  const servingWeight = cleanText(value(['식품중량', '식품중량/부피', '1회 섭취참고량', '1회분량중량/부피'])) || servingBasis;
  const manufacturer = cleanText(value(['제조사명', '제조업체명']));
  const distributor = cleanText(value(['유통업체명']));
  const importer = cleanText(value(['수입업체명']));
  const categoryLarge = cleanText(value(['식품대분류명']));
  const categoryMiddle = cleanText(value(['식품중분류명']));
  const categorySmall = cleanText(value(['식품소분류명']));
  const representativeFood = cleanText(value(['대표식품명']));
  const searchName = normalizeSearchText([foodName, representativeFood, categoryLarge, categoryMiddle, categorySmall, manufacturer, distributor].join(' '));

  return {
    food_code: foodCode,
    db_type: cleanText(value(['데이터구분명'])) || input.dbType,
    food_name: foodName,
    search_name: searchName,
    data_group: cleanText(value(['데이터구분명'])),
    origin_name: cleanText(value(['식품기원명'])),
    category_large: categoryLarge,
    category_middle: categoryMiddle,
    category_small: categorySmall,
    category_detail: cleanText(value(['식품세분류명', '유형명'])),
    representative_food: representativeFood,
    serving_basis: servingBasis,
    serving_weight: servingWeight,
    calories_kcal: numberValue(value(['에너지(kcal)'])),
    carbohydrates_g: numberValue(value(['탄수화물(g)'])),
    protein_g: numberValue(value(['단백질(g)'])),
    fat_g: numberValue(value(['지방(g)'])),
    saturated_fat_g: numberValue(value(['포화지방산(g)', '포화지방(g)'])),
    trans_fat_g: numberValue(value(['트랜스지방산(g)', '트랜스지방(g)'])),
    sugar_g: numberValue(value(['당류(g)'])),
    sodium_mg: numberValue(value(['나트륨(mg)'])),
    fiber_g: numberValue(value(['식이섬유(g)'])),
    leucine_mg: numberValue(value(['류신(mg)'])),
    caffeine_mg: numberValue(value(['카페인(mg)'])),
    manufacturer_name: manufacturer,
    importer_name: importer,
    distributor_name: distributor,
    report_no: cleanText(value(['품목제조보고번호'])),
    source_name: sourceName || '식품영양성분 공공 DB',
    source_file: input.sourceFile,
    standard_date: standardDate,
    updated_at: new Date().toISOString(),
  };
}

function createHeaderMap(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function pickValue(values, headerMap, headers) {
  for (const header of headers) {
    const index = headerMap.get(normalizeHeader(header));
    if (index != null) return values[index];
  }
  return '';
}

async function openWriter() {
  const fileName = `public-foods-seed-${String(chunkIndex + 1).padStart(4, '0')}.sql`;
  const filePath = path.join(outputDir, fileName);
  const handle = await fs.open(filePath, 'w');
  await handle.write('PRAGMA foreign_keys = ON;\n');
  chunkIndex += 1;
  manifest.chunks.push(fileName);
  return { handle, filePath };
}

async function closeWriter(currentWriter) {
  await currentWriter.handle.close();
}

function createInsertSql(record) {
  const values = insertColumns.map((column) => sqlValue(record[column]));
  const updates = updateColumns.map((column) => `${column} = excluded.${column}`).join(', ');
  return `INSERT INTO public_foods (${insertColumns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT(food_code) DO UPDATE SET ${updates};`;
}

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(extractCellValue(value)).replace(/,/g, '').trim();
  if (!text || text === '-' || text === 'N/A') return null;
  const number = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function cleanFoodName(value) {
  return cleanText(value).replace(/^[\uFEFF?？\s]+/, '').trim();
}

function cleanText(value) {
  return String(extractCellValue(value) ?? '')
    .normalize('NFKC')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '');
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, '');
}

function normalizeDate(value) {
  const raw = extractCellValue(value);
  if (!raw) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number' && raw > 20000 && raw < 90000) return excelSerialDateToIso(raw);
  const text = cleanText(raw);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{5}$/.test(text)) return excelSerialDateToIso(Number(text));
  if (/^\d{4}[.-]\d{2}[.-]\d{2}$/.test(text)) return text.replaceAll('.', '-');
  return text;
}

function excelSerialDateToIso(serial) {
  const date = new Date(Date.UTC(1899, 11, 30) + Number(serial) * 24 * 60 * 60 * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function extractCellValue(value) {
  if (value && typeof value === 'object') {
    if ('text' in value) return value.text;
    if ('result' in value) return value.result;
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('hyperlink' in value && 'text' in value) return value.text;
  }
  return value;
}

async function resetOutputDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  await Promise.all(
    files
      .filter((file) => file.startsWith('public-foods-seed-') || file === 'manifest.json')
      .map((file) => fs.unlink(path.join(dir, file))),
  );
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
