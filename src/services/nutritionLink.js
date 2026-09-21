// src/services/nutritionLink.js
// ════════════════════════════════════════════════════════════════════════
//  CMS(momgagym-cms2)가 발급한 1회용 연결코드를 memberRef + 연동토큰으로
//  교환하고, 그 연동 상태를 기기(브라우저)에 저장한다. 회원 이름·전화번호
//  등은 이 앱에 절대 다시 받지 않는다(요청 스펙 섹션 4) — 여기서 다루는
//  값은 memberRef(CMS 내부 회원 id)와 connectionToken뿐이다.
//
//  ⚠️ CMS는 momgagym-cms2.pages.dev, 이 앱은 momgagym-nutrition.pages.dev로
//  서로 다른 Cloudflare Pages 프로젝트(다른 오리진)다. 그래서 절대경로로
//  CMS API를 호출한다(CMS 쪽 functions/api/_middleware.js가 이 오리진을
//  CORS 허용 목록에 넣어둠 — momgagym-cms2 저장소의
//  functions/_shared/cors.js 참고).
// ════════════════════════════════════════════════════════════════════════
const STORAGE_KEY = 'nutritionCmsLink.v1';

// 기본값은 실제 운영 CMS 주소. 로컬 개발 시 .env의 VITE_CMS_API_BASE로 덮어쓸 수 있음.
export const CMS_API_BASE = (import.meta.env.VITE_CMS_API_BASE || 'https://momgagym-cms2.pages.dev').replace(/\/$/, '');

export function getConnection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.memberRef || !parsed?.connectionToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveConnection(connection) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export function clearConnection() {
  localStorage.removeItem(STORAGE_KEY);
}

/** CMS 관리자/트레이너가 불러준 8자리 코드를 memberRef + 연동토큰으로 교환한다. */
export async function exchangeLinkCode(code) {
  const trimmed = String(code || '').trim().toUpperCase();
  if (!trimmed) throw new Error('연결코드를 입력해주세요.');

  const response = await fetch(`${CMS_API_BASE}/api/nutrition-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'exchange', code: trimmed }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || data.message || '연결코드를 확인해주세요.');
  }

  const connection = { memberRef: data.memberRef, connectionToken: data.connectionToken, connectedAt: new Date().toISOString() };
  saveConnection(connection);
  return connection;
}

/** 회원이 앱에서 "연결 해제"를 누르면 서버 쪽 토큰도 즉시 무효화한다. */
export async function disconnect() {
  const connection = getConnection();
  if (!connection) return;
  try {
    await fetch(`${CMS_API_BASE}/api/nutrition-link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.connectionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    });
  } catch {
    // 네트워크 실패해도 로컬 연결 정보는 지운다 — 이 기기에서는 어차피 다시 연결화면으로 감.
  } finally {
    clearConnection();
  }
}
