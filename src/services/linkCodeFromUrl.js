// src/services/linkCodeFromUrl.js
// ════════════════════════════════════════════════════════════════════════
//  CMS(momgagym-cms2) 회원상세 화면이 만드는 연결 QR/링크
//  (momgagym-cms2/src/components/members/MemberDetail.jsx:24,82 —
//  `https://momgagym-nutrition.pages.dev/?code=AB12CD34`)의 code 쿼리파라미터를
//  꺼내는 순수 로직만 분리해둔다. AppGate.jsx(JSX)는 이 저장소의 테스트 러너
//  (`node --test`, JSX 미지원)로 직접 테스트할 수 없어서, 테스트 가능한 로직은
//  전부 이 순수 .js 파일로 뺀다 — nutritionLink.js/sessionGuard.js와 같은 패턴.
// ════════════════════════════════════════════════════════════════════════

/**
 * location.search(예: "?code=ab12cd34&utm=kakao")에서 연결코드를 꺼내고,
 * 지운 나머지 쿼리스트링을 함께 돌려준다. 코드는 대문자로 정규화한다
 * (nutritionLink.js의 exchangeLinkCode와 동일 규칙).
 */
export function extractLinkCodeFromSearch(search) {
  const params = new URLSearchParams(search || '');
  const raw = params.get('code');
  const code = raw ? raw.trim().toUpperCase() : '';
  if (!code) return { code: null, nextSearch: search || '' };
  params.delete('code');
  const rest = params.toString();
  return { code, nextSearch: rest ? `?${rest}` : '' };
}

/**
 * 브라우저 주소창(QR로 열렸을 때)에서 1회용 연결코드를 꺼내고 주소창에서 즉시 지운다.
 * 지우지 않으면 ① 새로고침할 때마다 이미 소모된 코드로 재시도해 에러가 뜨고,
 * ② 이 페이지 주소를 그대로 다시 공유/북마크하면 남의 연결코드가 노출된다.
 * win 인자는 테스트에서 가짜 location/history를 주입하기 위한 것 — 기본은 전역 window.
 * window가 없는 환경(SSR 등)이면 null을 돌려준다.
 */
export function consumeUrlLinkCode(win = (typeof window !== 'undefined' ? window : undefined)) {
  if (!win?.location) return null;
  const { code, nextSearch } = extractLinkCodeFromSearch(win.location.search);
  if (!code) return null;
  try {
    win.history.replaceState(null, '', `${win.location.pathname}${nextSearch}${win.location.hash}`);
  } catch {
    // history API를 못 쓰는 환경이면 URL 정리만 건너뛴다 — 코드 추출 자체는 이미 끝났으므로 연결은 그대로 진행.
  }
  return code;
}
