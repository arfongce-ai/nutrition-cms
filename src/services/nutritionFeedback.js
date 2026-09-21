// src/services/nutritionFeedback.js
// 회원 본인 피드백 조회·읽음·답변 — CMS functions/api/nutrition-feedback.js 호출.
import { CMS_API_BASE, getConnection } from './nutritionLink';
import { ensureEligible } from './sessionGuard';

async function callFeedback(method, body) {
  const connection = getConnection();
  if (!connection) throw new Error('아직 센터 회원 연결이 되어 있지 않습니다.');
  await ensureEligible();

  const response = await fetch(`${CMS_API_BASE}/api/nutrition-feedback`, {
    method,
    headers: {
      Authorization: `Bearer ${connection.connectionToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.message || data.error || '피드백을 불러오지 못했습니다.');
  return data;
}

export async function fetchMyFeedback() {
  const data = await callFeedback('GET');
  return data.feedback || [];
}

export async function markFeedbackRead(feedbackId) {
  return callFeedback('POST', { action: 'read', feedbackId });
}

export async function replyToFeedback(feedbackId, reply) {
  return callFeedback('POST', { action: 'reply', feedbackId, reply });
}
