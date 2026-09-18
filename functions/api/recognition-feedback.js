const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const MAX_IMAGE_BYTES = 400_000;

export async function onRequestOptions() {
  return new Response(null, { headers });
}

export async function onRequestPost({ request, env }) {
  if (!env.NUTRITION_DB) return respond({ ok: false, message: '학습 DB가 연결되지 않았습니다.' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ ok: false, message: '올바른 요청이 아닙니다.' }, 400);
  }

  if (body?.consent !== true) return respond({ ok: false, message: '사진 저장 동의가 필요합니다.' }, 400);
  const confirmedName = clean(body?.confirmedName, 120);
  if (!confirmedName) return respond({ ok: false, message: '확정 음식명이 필요합니다.' }, 400);

  const image = String(body?.image || '');
  const match = image.match(/^data:image\/(jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return respond({ ok: false, message: '지원하지 않는 이미지 형식입니다.' }, 400);

  let bytes;
  try {
    const binary = atob(match[2]);
    if (!binary.length || binary.length > MAX_IMAGE_BYTES) throw new Error('invalid size');
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return respond({ ok: false, message: '이미지가 너무 크거나 손상되었습니다.' }, 400);
  }

  const candidateNames = Array.isArray(body?.candidateNames)
    ? body.candidateNames.map((value) => clean(value, 120)).filter(Boolean).slice(0, 8)
    : [];
  const id = crypto.randomUUID();
  const mime = match[1].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${match[1].toLowerCase()}`;

  await env.NUTRITION_DB.prepare(`
    INSERT INTO recognition_feedback (
      id, created_at, image_mime, image_blob, image_bytes, detected_name,
      confirmed_name, source_label, source_url, official, confidence,
      recognition_source, candidate_names_json, app_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    new Date().toISOString(),
    mime,
    bytes.buffer,
    bytes.byteLength,
    clean(body?.detectedName, 120),
    confirmedName,
    clean(body?.sourceLabel, 180),
    safeUrl(body?.sourceUrl),
    body?.official ? 1 : 0,
    clamp(Number(body?.confidence || 0), 0, 1),
    clean(body?.recognitionSource, 80),
    JSON.stringify(candidateNames),
    'web-v1',
  ).run();

  return respond({ ok: true, id, storedBytes: bytes.byteLength });
}

function clean(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function safeUrl(value) {
  const url = clean(value, 500);
  return /^https:\/\//i.test(url) ? url : '';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function respond(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}
