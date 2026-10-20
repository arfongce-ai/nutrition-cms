// scripts/lib/brandMenuDiff.mjs
// ════════════════════════════════════════════════════════════════════════
//  브랜드 임포터(import-official-menu-db.mjs:144, import-krispy-kreme-menu-db.mjs:86)는
//  실행할 때마다 verifiedAt을 오늘 날짜로 다시 찍기 때문에, 실제 메뉴가 하나도
//  안 바뀌어도 매번 git diff가 발생한다("오늘 날짜 도장"만 찍히는 것과 "진짜
//  메뉴/영양정보가 바뀐 것"을 구분 못 하면 매일 빈 PR이 열리게 된다). 날짜 필드를
//  제외하고 비교해야 "진짜 바뀐 것"만 잡아낼 수 있어 이 순수 로직만 분리해둔다
//  (scripts/check-brand-menu-changes.mjs가 이걸 쓰고, node --test로는 이 파일만
//  테스트한다 — 네트워크를 쓰는 임포터 자체는 기존 관례대로 테스트 대상 아님).
// ════════════════════════════════════════════════════════════════════════

// 브랜드 임포터가 실행할 때마다 다시 찍는, 비교에서 제외해야 할 필드.
const VOLATILE_FIELDS = ['verifiedAt'];

/** official-products.json의 products 배열에서 이 브랜드 것만 골라, 비교용 Map(id -> 정규화된 JSON 문자열)을 만든다. */
export function snapshotBrandProducts(products, brandLabel) {
  const snapshot = new Map();
  (Array.isArray(products) ? products : [])
    .filter((product) => product?.brand === brandLabel)
    .forEach((product) => {
      const normalized = { ...product };
      VOLATILE_FIELDS.forEach((field) => delete normalized[field]);
      snapshot.set(product.id, JSON.stringify(normalized));
    });
  return snapshot;
}

/** 두 스냅샷(Map)을 비교해 추가/삭제/수정된 product id 목록과 변경 여부를 돌려준다. */
export function diffBrandSnapshots(before, after) {
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id));
  return { added, removed, changed, hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0 };
}

/** product id 목록을 사람이 읽을 제품명 목록으로 바꾼다(없으면 id 그대로). */
export function idsToProductNames(products, ids) {
  const byId = new Map((Array.isArray(products) ? products : []).map((product) => [product.id, product.productName]));
  return ids.map((id) => byId.get(id) || id);
}

/** diffBrandSnapshots 결과를 PR 본문용 한국어 요약 줄 배열로 바꾼다. */
export function summarizeDiff(diff, { beforeProducts, afterProducts }) {
  return [
    diff.added.length ? `신규 ${diff.added.length}건: ${idsToProductNames(afterProducts, diff.added).join(', ')}` : '',
    diff.removed.length ? `삭제(단종 추정) ${diff.removed.length}건: ${idsToProductNames(beforeProducts, diff.removed).join(', ')}` : '',
    diff.changed.length ? `영양정보 변경 ${diff.changed.length}건: ${idsToProductNames(afterProducts, diff.changed).join(', ')}` : '',
  ].filter(Boolean);
}
