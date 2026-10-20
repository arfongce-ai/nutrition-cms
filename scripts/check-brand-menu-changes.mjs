#!/usr/bin/env node
// scripts/check-brand-menu-changes.mjs
// ════════════════════════════════════════════════════════════════════════
//  매일 자동 실행되는 "브랜드 메뉴 변경 감지기" (.github/workflows/daily-brand-menu-check.yml).
//  기존 브랜드 임포터(import-official-menu-db.mjs, import-krispy-kreme-menu-db.mjs)는
//  손대지 않고 그대로 재사용한다 — 새 임포터를 또 만들지 않는다("있던 것에 추가" 원칙).
//
//  임포터를 실행 전/후로 해당 브랜드 제품만 스냅샷(scripts/lib/brandMenuDiff.mjs,
//  verifiedAt 같은 날짜 필드는 제외)해서 비교한다. 진짜 메뉴 내용이 바뀐 경우에만
//  변경된 data/official-products.json을 남겨 GitHub Actions가 PR을 열게 하고,
//  날짜 도장만 바뀐 경우(= 실제로는 아무 것도 안 바뀐 경우)는 git checkout으로
//  조용히 되돌린다 — 매일 빈 PR이 쌓이는 걸 막기 위함(콘텐츠 자동화의 "재고 충분하면
//  조용히 종료" 패턴과 동일).
//
//  사용: node scripts/check-brand-menu-changes.mjs <brand-key>
//  brand-key: starbucks | krispy-kreme | paikdabang | coffeebean | megamgc | compose | dominos | baskinrobbins
//  GitHub Actions에서 쓰도록 $GITHUB_OUTPUT에 changed=true|false, summary=... 를
//  쓴다(로컬 실행 등 그 환경변수가 없으면 건너뜀). 사람이 읽을 결과는 stdout에도 출력.
// ════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { snapshotBrandProducts, diffBrandSnapshots, summarizeDiff } from './lib/brandMenuDiff.mjs';

const BRANDS = {
  starbucks: {
    label: '스타벅스',
    run: () => execFileSync('node', ['scripts/import-official-menu-db.mjs', '--brand', 'starbucks', '--merge'], { stdio: 'inherit' }),
    // 임포터가 official-products.json 말고 추가로 매번 다시 쓰는 파일(날짜 도장 포함) — 변경 없을 때 같이 되돌림.
    extraTrackedPaths: ['data/imported/starbucks-official-products.json'],
  },
  'krispy-kreme': {
    label: '크리스피크림도넛',
    run: () => execFileSync('node', ['scripts/import-krispy-kreme-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
  paikdabang: {
    label: '빽다방',
    run: () => execFileSync('node', ['scripts/import-paikdabang-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
  coffeebean: {
    label: '커피빈',
    run: () => execFileSync('node', ['scripts/import-coffeebean-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
  megamgc: {
    label: '메가MGC커피',
    run: () => execFileSync('node', ['scripts/import-megamgc-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
  compose: {
    label: '컴포즈커피',
    run: () => execFileSync('node', ['scripts/import-compose-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
  dominos: {
    label: '도미노피자',
    run: () => execFileSync('node', ['scripts/import-dominos-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
  baskinrobbins: {
    label: '배스킨라빈스',
    run: () => execFileSync('node', ['scripts/import-baskinrobbins-menu-db.mjs'], { stdio: 'inherit' }),
    extraTrackedPaths: [],
  },
};

const brandKey = process.argv[2];
const brand = BRANDS[brandKey];
if (!brand) {
  console.error(`Usage: node scripts/check-brand-menu-changes.mjs <${Object.keys(BRANDS).join('|')}>`);
  process.exit(1);
}

const rootDir = process.cwd();
const productPath = path.join(rootDir, 'data', 'official-products.json');

const beforeData = JSON.parse(await fs.readFile(productPath, 'utf8'));
const before = snapshotBrandProducts(beforeData.products, brand.label);

brand.run();

const afterData = JSON.parse(await fs.readFile(productPath, 'utf8'));
const after = snapshotBrandProducts(afterData.products, brand.label);

const diff = diffBrandSnapshots(before, after);

if (!diff.hasChanges) {
  // 날짜 도장만 찍히고 실제 메뉴 내용은 그대로 — 커밋할 게 없게 원래대로 되돌린다.
  const pathsToRevert = [productPath, ...brand.extraTrackedPaths.map((p) => path.join(rootDir, p))];
  execFileSync('git', ['checkout', '--', ...pathsToRevert], { stdio: 'inherit' });
  console.log(`[${brandKey}] 변경 없음 — 날짜 도장만 되돌림.`);
  await writeGithubOutput({ changed: 'false' });
  process.exit(0);
}

const summaryLines = summarizeDiff(diff, { beforeProducts: beforeData.products, afterProducts: afterData.products });
const summary = summaryLines.join('\n');

console.log(`[${brandKey}] 변경 감지됨:`);
console.log(summary);
await writeGithubOutput({ changed: 'true', summary });

async function writeGithubOutput(fields) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return; // 로컬 실행 등 Actions 환경이 아니면 건너뜀
  const lines = Object.entries(fields).map(([key, value]) => {
    if (!value.includes('\n')) return `${key}=${value}`;
    const delimiter = `EOF_${key}_${Date.now()}`;
    return `${key}<<${delimiter}\n${value}\n${delimiter}`;
  });
  await fs.appendFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
