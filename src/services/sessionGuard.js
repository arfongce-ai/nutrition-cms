// src/services/sessionGuard.js
// ════════════════════════════════════════════════════════════════════════
//  "지금 이 회원이 앱을 써도 되는가"를 CMS 서버(/api/nutrition-session)에
//  매번 물어본다. 요청 스펙 섹션 5: 앱 실행·새로고침·포그라운드 복귀·기록
//  조회·저장·사진업로드·피드백조회 시점마다 재확인, 네트워크가 없어
//  재확인하지 못하면 앱을 열지 않는다.
//
//  캐시는 아주 짧게만 둔다(CHECK_CACHE_MS) — "매번 재확인"의 취지를 지키되,
//  같은 순간에 여러 곳(App 마운트 + 저장 액션)에서 동시에 호출해도 중복
//  네트워크 요청을 피하기 위한 최소한의 디바운스일 뿐, 이용권한을 오래
//  신뢰하고 넘어가는 용도가 아니다.
// ════════════════════════════════════════════════════════════════════════
import { CMS_API_BASE, getConnection, clearConnection } from './nutritionLink';

const CHECK_CACHE_MS = 5000;
let lastCheck = null; // { at, result }
let inFlight = null;

/**
 * @returns {Promise<{ eligible:true } | { eligible:false, code:string, message:string }>}
 */
export async function checkEligibility({ force = false } = {}) {
  const connection = getConnection();
  if (!connection) {
    return { eligible: false, code: 'NOT_CONNECTED', message: '아직 센터 회원 연결이 되어 있지 않습니다.' };
  }

  if (!force && lastCheck && Date.now() - lastCheck.at < CHECK_CACHE_MS) {
    return lastCheck.result;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let result;
    try {
      const response = await fetch(`${CMS_API_BASE}/api/nutrition-session`, {
        headers: { Authorization: `Bearer ${connection.connectionToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        result = { eligible: true };
      } else if (data.code === 'LINK_DISCONNECTED' || data.code === 'LINK_INVALID' || data.code === 'MEMBER_NOT_FOUND') {
        // 서버가 이 연결을 더 이상 인정하지 않음 — 로컬 연결 정보를 지워 처음부터 다시 연결하게 한다.
        clearConnection();
        result = { eligible: false, code: data.code, message: data.message || '연결이 해제되었습니다. 센터에 문의해 다시 연결해주세요.' };
      } else {
        result = { eligible: false, code: data.code || 'SERVICE_UNAVAILABLE', message: data.message || '이용권한을 확인하지 못했습니다.' };
      }
    } catch {
      // 요청 스펙 섹션 5: 네트워크가 없어 재검증 못하면 앱을 열지 않는다.
      result = { eligible: false, code: 'OFFLINE', message: '인터넷 연결을 확인해주세요. 이용기간 확인 후에만 앱을 열 수 있습니다.' };
    }
    lastCheck = { at: Date.now(), result };
    inFlight = null;
    return result;
  })();

  return inFlight;
}

export function invalidateEligibilityCache() {
  lastCheck = null;
}

/** reportStore.js 등 실제 쓰기 동작 직전에 호출 — 자격 없으면 예외를 던진다. */
export async function ensureEligible() {
  const result = await checkEligibility();
  if (!result.eligible) {
    throw Object.assign(new Error(result.message || '지금은 이용할 수 없습니다.'), { code: result.code });
  }
}
