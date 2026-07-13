import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node scripts/import-brand-source-candidates.mjs <csv-file>');

const rootDir = process.cwd();
const outputPath = path.join(rootDir, 'data', 'brand-source-candidates.json');
const sourceText = await fs.readFile(path.resolve(inputPath), 'utf8');
const rows = parseCsv(sourceText);
if (rows.length < 2) throw new Error('The CSV must contain a header and at least one data row.');

const headers = rows[0].map((value) => value.trim());
const candidates = rows
  .slice(1)
  .filter((row) => row.some((value) => value.trim()))
  .map((row, index) => createCandidate(headers, row, index + 2));
const duplicateBrands = candidates
  .filter((item, index, all) => all.findIndex((other) => normalize(other.brand) === normalize(item.brand)) !== index)
  .map((item) => item.brand);

const output = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  reviewPolicy: '후보 URL은 공식 페이지와 영양성분 존재 여부를 직접 확인한 뒤에만 공식 출처 또는 D1 brands 테이블로 승격합니다.',
  candidates,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, candidates: candidates.length, duplicateBrands: [...new Set(duplicateBrands)], outputPath }, null, 2));

function createCandidate(headers, row, lineNumber) {
  const record = Object.fromEntries(headers.map((header, index) => [header, String(row[index] || '').trim()]));
  const number = toInteger(findValue(record, ['번호']));
  const category = findValue(record, ['카테고리']);
  const brand = findValue(record, ['브랜드명']);
  const listUrl = findValue(record, ['메뉴 목록 주소 (List URL)', '메뉴 목록 주소']);
  const nutritionUrl = findValue(record, ['성분표 확인 딥링크 주소 및 규칙 (Deep Link / Parameter)', '성분표 확인 딥링크 주소 및 규칙']);
  const parsingHint = findValue(record, ['데이터 특징 및 파싱 팁']);

  if (!number || !brand || !category) throw new Error(`Line ${lineNumber} is missing number, category, or brand.`);
  validateUrl(listUrl, lineNumber, 'list URL');
  validateUrl(nutritionUrl, lineNumber, 'nutrition URL');

  return {
    number,
    category,
    brand,
    aliases: createAliases(brand),
    listUrl,
    nutritionUrl,
    parsingHint,
    extractionHint: inferExtractionHint(nutritionUrl, parsingHint),
    verificationStatus: 'unverified',
    verifiedAt: null,
    verificationNote: '사용자 제공 후보. 공식 사이트 접근, 실제 영양성분 존재, 이용조건을 확인하기 전에는 분석 근거로 사용하지 않음.',
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (quoted) throw new Error('The CSV contains an unterminated quoted field.');
  return rows;
}

function findValue(record, acceptedHeaders) {
  const header = Object.keys(record).find((key) => acceptedHeaders.some((accepted) => key === accepted || key.startsWith(accepted)));
  return header ? record[header] : '';
}

function validateUrl(value, lineNumber, label) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error(`Line ${lineNumber} has an invalid ${label}: ${value}`);
  }
}

function inferExtractionHint(url, hint) {
  const text = `${url} ${hint}`.toLowerCase();
  if (text.includes('.pdf') || text.includes('pdf')) return 'PDF';
  if (text.includes('json') || text.includes('ajax') || text.includes('api')) return 'OFFICIAL_JSON';
  if (text.includes('spa') || text.includes('동적') || text.includes('팝업') || text.includes('레이어')) return 'DYNAMIC';
  return 'STATIC_OR_MANUAL';
}

function createAliases(brand) {
  return [...new Set(String(brand).split(/[\/·()]/).map((part) => part.trim()).filter(Boolean).concat(brand))];
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : 0;
}
