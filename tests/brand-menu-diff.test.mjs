import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotBrandProducts, diffBrandSnapshots, summarizeDiff } from '../scripts/lib/brandMenuDiff.mjs';

const starbucksAmericano = (overrides = {}) => ({
  id: 'starbucks-americano-001',
  brand: '스타벅스',
  productName: '아메리카노',
  verifiedAt: '2026-01-01',
  nutrients: { calories: 10 },
  ...overrides,
});

test('snapshotBrandProducts only includes the given brand and strips verifiedAt', () => {
  const products = [
    starbucksAmericano(),
    { id: 'krispy-001', brand: '크리스피크림도넛', productName: '오리지널 글레이즈드', verifiedAt: '2026-01-01' },
  ];
  const snapshot = snapshotBrandProducts(products, '스타벅스');
  assert.equal(snapshot.size, 1);
  assert.ok(snapshot.has('starbucks-americano-001'));
  assert.equal(JSON.parse(snapshot.get('starbucks-americano-001')).verifiedAt, undefined);
});

test('diffBrandSnapshots reports no changes when only the volatile date field differs', () => {
  const before = snapshotBrandProducts([starbucksAmericano({ verifiedAt: '2026-01-01' })], '스타벅스');
  const after = snapshotBrandProducts([starbucksAmericano({ verifiedAt: '2026-06-01' })], '스타벅스');
  const diff = diffBrandSnapshots(before, after);
  assert.deepEqual(diff, { added: [], removed: [], changed: [], hasChanges: false });
});

test('diffBrandSnapshots detects a newly added product', () => {
  const before = snapshotBrandProducts([starbucksAmericano()], '스타벅스');
  const after = snapshotBrandProducts(
    [starbucksAmericano(), { id: 'starbucks-new-002', brand: '스타벅스', productName: '신메뉴', verifiedAt: '2026-06-01' }],
    '스타벅스',
  );
  const diff = diffBrandSnapshots(before, after);
  assert.deepEqual(diff.added, ['starbucks-new-002']);
  assert.equal(diff.hasChanges, true);
});

test('diffBrandSnapshots detects a removed (discontinued) product', () => {
  const before = snapshotBrandProducts(
    [starbucksAmericano(), { id: 'starbucks-old-003', brand: '스타벅스', productName: '단종메뉴', verifiedAt: '2026-01-01' }],
    '스타벅스',
  );
  const after = snapshotBrandProducts([starbucksAmericano()], '스타벅스');
  const diff = diffBrandSnapshots(before, after);
  assert.deepEqual(diff.removed, ['starbucks-old-003']);
  assert.equal(diff.hasChanges, true);
});

test('diffBrandSnapshots detects a real nutrient-value change on an existing product', () => {
  const before = snapshotBrandProducts([starbucksAmericano({ nutrients: { calories: 10 } })], '스타벅스');
  const after = snapshotBrandProducts([starbucksAmericano({ verifiedAt: '2026-06-01', nutrients: { calories: 15 } })], '스타벅스');
  const diff = diffBrandSnapshots(before, after);
  assert.deepEqual(diff.changed, ['starbucks-americano-001']);
  assert.equal(diff.hasChanges, true);
});

test('summarizeDiff produces readable Korean lines only for non-empty buckets', () => {
  const beforeProducts = [starbucksAmericano(), { id: 'starbucks-old-003', brand: '스타벅스', productName: '단종메뉴', verifiedAt: '2026-01-01' }];
  const afterProducts = [
    starbucksAmericano({ verifiedAt: '2026-06-01', nutrients: { calories: 15 } }),
    { id: 'starbucks-new-002', brand: '스타벅스', productName: '신메뉴', verifiedAt: '2026-06-01' },
  ];
  const diff = diffBrandSnapshots(snapshotBrandProducts(beforeProducts, '스타벅스'), snapshotBrandProducts(afterProducts, '스타벅스'));
  const lines = summarizeDiff(diff, { beforeProducts, afterProducts });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /신규 1건: 신메뉴/);
  assert.match(lines[1], /삭제\(단종 추정\) 1건: 단종메뉴/);
  assert.match(lines[2], /영양정보 변경 1건: 아메리카노/);
});

test('summarizeDiff returns an empty array when nothing changed', () => {
  const products = [starbucksAmericano()];
  const diff = diffBrandSnapshots(snapshotBrandProducts(products, '스타벅스'), snapshotBrandProducts(products, '스타벅스'));
  assert.deepEqual(summarizeDiff(diff, { beforeProducts: products, afterProducts: products }), []);
});
