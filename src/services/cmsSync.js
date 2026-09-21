// src/services/cmsSync.js
// ════════════════════════════════════════════════════════════════════════
//  회원의 "하루 요약"만 CMS(momgagym-cms2)로 보낸다. 원본 사진·상세
//  건강정보는 절대 포함하지 않는다(요청 스펙 섹션 6 — CMS 쪽
//  functions/api/nutrition-summary.js가 어차피 그 외 필드는 다 버리지만,
//  애초에 보내지도 않는다).
//
//  waterMl/dayCompleted는 실제 "하루 일기"(diaryInsights.js의
//  readJournal(), DiaryCalendar.jsx의 일기 입력 UI)에 저장된 값을 그대로
//  쓴다 — 2026-09-18에 실제 nutrition-cms 소스를 받아 확인: 물 섭취
//  기록(mL)과 "하루 기록 완료" 체크는 이미 존재하는 기능이었다(이전 조사는
//  이 파일을 못 보고 내린 잘못된 결론이었음 — 이제 실제 데이터를 쓴다).
//
//  dailyNote(일기 메모)는 일부러 보내지 않는다 — 원 스펙 섹션 6 "하루
//  메모는 회원이 선생님과 공유하는 항목으로 별도 동의를 받는다"인데,
//  DiaryCalendar.jsx의 일기 입력에는 "선생님과 공유" 동의 체크박스가 아직
//  없다(그냥 개인 일기 note 필드뿐). 동의 UI가 생기기 전까지는 이 항목을
//  전송 payload에서 아예 뺀다 — CMS 쪽 nutrition-summary.js도 consent!==true면
//  버리므로 이중 안전장치.
//
//  reportStore.js의 readLocalReports()가 Firebase 저장 성공 여부와 무관하게
//  항상 로컬에도 남기므로(saveNutritionReport 참고), "오늘 기록"의 원천은
//  이 로컬 사본을 그대로 쓴다 — 별도 조회 없이 항상 최신 상태.
// ════════════════════════════════════════════════════════════════════════
import { CMS_API_BASE, getConnection } from './nutritionLink';
import { readLocalReports } from './reportStore';
import { readJournal, dateKey } from './diaryInsights';
import { ensureEligible } from './sessionGuard';

function todayYMD() {
  return dateKey(new Date());
}

function sumTodayTotals(reports, journal, dateYMD) {
  const todays = reports.filter((r) => String(r.createdAt || '').startsWith(dateYMD));
  const entry = journal[dateYMD] || {};
  const totals = { calories: 0, carbG: 0, proteinG: 0, fatG: 0, sugarG: 0, sodiumMg: 0, waterMl: 0 };
  let missingNutrition = false;

  todays.forEach((report) => {
    const t = report.totals || {};
    totals.calories += Number(t.calories || 0);
    totals.carbG += Number(t.carb || 0);
    totals.proteinG += Number(t.protein || 0);
    totals.fatG += Number(t.fat || 0);
    totals.sugarG += Number(t.sugar || 0);
    totals.sodiumMg += Number(t.sodium || 0);
    if (report.status === 'PENDING' || (report.pendingItems || []).length > 0) missingNutrition = true;
  });

  // 물 섭취는 그날 일기에 실제로 기록된 값만 보낸다(waterRecorded===true일 때만).
  // 기록 안 한 날은 0이 아니라 "모름"에 가깝지만, CMS 쪽 필드가 숫자 하나뿐이라
  // 미기록은 0으로 보낸다 — missingNutrition과 별개로, 향후 "물 미기록" 플래그가
  // CMS 계약에 추가되면 그때 보완한다.
  totals.waterMl = entry.waterRecorded ? Number(entry.waterMl || 0) : 0;

  return {
    date: dateYMD,
    recordedMealCount: todays.length,
    // "하루 기록 완료"는 회원이 일기에서 직접 체크하는 값(entry.complete)을
    // 그대로 쓴다 — 식사 기록이 있다고 자동으로 완료 처리하지 않는다.
    dayCompleted: Boolean(entry.complete),
    totals,
    missingNutrition,
  };
}

/**
 * 오늘 기록을 CMS로 동기화한다. 연결이 안 되어 있으면 조용히 건너뛴다
 * (연결 전에도 로컬 저장 자체는 계속 되어야 하므로 — 회원 앱은 연결 여부와
 * 무관하게 "기록"만은 늘 가능해야 기존 기능을 안 깨뜨림. 다만 연결·이용권한이
 * 있어야만 실제로 CMS에 반영된다).
 */
export async function syncTodaySummaryToCms(options = {}) {
  const connection = getConnection();
  if (!connection) return { synced: false, reason: 'NOT_CONNECTED' };

  try {
    await ensureEligible();
  } catch (e) {
    return { synced: false, reason: e.code || 'INELIGIBLE', message: e.message };
  }

  const dateYMD = options.date || todayYMD();
  const summary = sumTodayTotals(readLocalReports(), readJournal(), dateYMD);

  try {
    const response = await fetch(`${CMS_API_BASE}/api/nutrition-summary`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${connection.connectionToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...summary,
        sourceUpdatedAt: new Date().toISOString(),
        // consent===true일 때만 dailyNote를 함께 보낸다(요청 스펙 섹션 6) — "선생님과
        // 공유" 동의 UI가 아직 없어(위 파일 상단 주석 참고) 항상 생략한다.
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return { synced: false, reason: data.code || 'SERVICE_UNAVAILABLE', message: data.message };
    }
    return { synced: true };
  } catch {
    return { synced: false, reason: 'OFFLINE' };
  }
}
