const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

export async function onRequestPost({ request, env }) {
  if (!env.AI && !env.OPENAI_API_KEY) {
    return json({ ok: false, code: 'vision_not_configured', message: '비전 분석 키가 설정되지 않았습니다.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '올바른 이미지 요청이 아닙니다.' }, 400);
  }

  const image = String(body?.image || '');
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image) || image.length > 6_000_000) {
    return json({ ok: false, message: '지원하지 않거나 너무 큰 이미지입니다.' }, 400);
  }

  let outputText = '';
  let provider = '';
  let quotaExceeded = false;

  if (env.AI) {
    try {
      const result = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
        messages: [
          { role: 'system', content: '당신은 음식 사진 분석기입니다. 설명 없이 유효한 JSON 객체만 반환합니다.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: createFallbackRecognitionPrompt() },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        max_completion_tokens: 1100,
        reasoning_effort: 'low',
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });
      outputText = extractWorkersAiText(result);
      provider = 'cloudflare-gemma-fast';
    } catch (error) {
      quotaExceeded = quotaExceeded || isAiQuotaError(error);
      console.error('Cloudflare Gemma vision failed', error);
    }
  }

  let parsed = parseJsonObject(outputText);

  if (!outputText && quotaExceeded && !env.OPENAI_API_KEY) {
    return json({
      ok: false,
      code: 'ai_free_quota_exceeded',
      message: '무료 AI 한도를 초과했습니다. AI 인식이 일시 제한될 수 있으며, DB 직접 검색과 수동 선택은 계속 사용할 수 있습니다.',
    }, 429);
  }

  if ((!Array.isArray(parsed?.foods) || !parsed.foods.length) && env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      max_output_tokens: 1100,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: createRecognitionPrompt(),
            },
            { type: 'input_image', image_url: image, detail: 'low' },
          ],
        },
      ],
    }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI vision request failed', response.status, errorText.slice(0, 500));
      if (response.status === 429) {
        return json({
          ok: false,
          code: 'ai_free_quota_exceeded',
          message: '무료 AI 한도를 초과했습니다. AI 인식이 일시 제한될 수 있으며, DB 직접 검색과 수동 선택은 계속 사용할 수 있습니다.',
        }, 429);
      }
      return json({ ok: false, code: 'vision_provider_error', message: '비전 분석 요청에 실패했습니다.' }, 502);
    }

    const payload = await response.json();
    outputText = extractOutputText(payload);
    parsed = parseJsonObject(outputText);
    provider = 'openai';
  }

  parsed = parsed || parseJsonObject(outputText);
  const foods = Array.isArray(parsed?.foods)
    ? parsed.foods
        .map((food) => ({
          name: String(food?.name || '').trim(),
          brand: String(food?.brand || '').trim(),
          englishName: String(food?.englishName || '').trim().slice(0, 100),
          confidence: Math.min(
            provider.startsWith('cloudflare-gemma') ? 0.82 : 1,
            clamp(Number(food?.confidence || 0), 0, 1),
          ),
          estimatedGrams: clamp(Number(food?.estimatedGrams || 0), 0, 5000),
          quantity: clamp(Math.round(Number(food?.quantity || 0)), 0, 100),
          unitLabel: normalizeUnitLabel(food?.unitLabel),
          foodType: normalizeFoodType(food?.foodType),
          position: normalizePosition(food?.position),
        }))
        .filter((food) => food.name && food.confidence >= 0.55)
        .slice(0, 8)
    : [];

  return json({ ok: true, provider, foods, reason: String(parsed?.reason || '').slice(0, 200) });
}

function createShortRecognitionPrompt() {
  return 'List every visible food or drink using short common English names. Count repeated items explicitly, for example "6 glazed donuts". Include canned drinks, steak, butter, corn, rice, soup, kimchi, meat, egg, and each visible side dish. Read a clearly visible brand or product name. Ignore plates, boxes, tables, and backgrounds. If no food or drink is visible, reply NONE.';
}

function createNormalizationPrompt(observation) {
  return [
    `비전 모델 관찰: ${observation.slice(0, 500)}`,
    '관찰에 명시된 실제 음식을 밥·국·김치·고기·계란·나물 등 항목별로 분리하여 한국어 일반명으로 정규화하세요. 식기, 포장, 배경은 제외하세요.',
    '각 음식의 englishName에는 원래 영어 일반명을 넣고 확실하지 않은 브랜드는 빈 문자열로 두세요.',
    'estimatedGrams는 보이는 양의 추정치이며, 양을 판단할 근거가 없으면 0으로 반환하세요. 일반 1인분 무게를 임의로 넣지 마세요.',
    'JSON 형식: {"foods":[{"name":"한국어명","englishName":"English name","brand":"","confidence":0.72,"estimatedGrams":100,"quantity":1,"unitLabel":"개","foodType":"meal"}],"reason":"비전 관찰 기반"}',
  ].join('\n');
}

function createFallbackRecognitionPrompt(observation = '') {
  return [
    '각 음식의 사진 내 중심 위치를 position:{"x":0.5,"y":0.5}로 반환하세요. x는 왼쪽0~오른쪽1, y는 위0~아래1이며 위치가 불명확하면 null입니다.',
    observation && !/^none\.?$/i.test(observation) ? `1차 모델 관찰: ${observation.slice(0, 500)}` : '1차 모델이 음식을 확정하지 못했습니다. 사진을 직접 다시 확인하세요.',
    '사진에 실제로 보이는 음식과 음료를 밥·국·김치·고기·계란·나물 등 항목별로 분리하고 식기, 포장, 배경은 제외하세요.',
    '캔 음료, 스테이크, 도넛처럼 일반적인 음식도 반드시 반환하고, 상표나 제품명이 글자로 선명하게 보일 때만 brand와 정확한 이름에 반영하세요.',
    '같은 도넛이나 과일이 여러 개 보이면 직접 세어 quantity에 전체 개수를 넣고 estimatedGrams에는 전체 중량을 넣으세요.',
    '메인 음식뿐 아니라 옥수수, 버터, 김치처럼 실제 섭취하는 곁들임도 별도 항목으로 반환하세요. 소스 그릇은 내용물을 확실히 알 때만 포함하세요.',
    '양을 판단할 근거가 없으면 estimatedGrams는 0으로 반환하세요. 일반 1인분 무게를 임의로 넣지 마세요.',
    'JSON 형식: {"foods":[{"name":"한국어 음식명","englishName":"English name","brand":"","confidence":0.65,"estimatedGrams":100,"quantity":1,"unitLabel":"개","foodType":"meal"}],"reason":"사진에서 확인한 짧은 근거"}',
  ].join('\n');
}

function createRecognitionPrompt() {
  return [
    '각 음식의 사진 내 중심 위치를 position:{"x":0.5,"y":0.5}로 반환하세요. x는 왼쪽0~오른쪽1, y는 위0~아래1이며 위치가 불명확하면 null입니다.',
    '사진의 전경에서 실제로 보이는 음식, 반찬, 과일 또는 음료를 빠짐없이 각각 식별하세요.',
    '한식 한 상처럼 여러 그릇이나 반찬이 있으면 서로 다른 음식을 foods 배열의 별도 항목으로 최대 8가지까지 반환하세요.',
    '같은 종류의 과일이나 달걀처럼 낱개로 셀 수 있으면 한 항목으로 묶고 보이는 개수를 quantity에 정수로 기록하세요.',
    '도넛처럼 같은 음식이 여러 개면 겹치거나 일부 가려진 항목까지 보이는 개수를 직접 세고 quantity에 전체 개수를 기록하세요.',
    'estimatedGrams는 한 개 무게가 아니라 화면에 보이는 해당 음식 전체의 섭취 가능 중량 합계로 추정하세요. 양을 판단할 근거가 없으면 0을 반환하세요. 사진 추정은 실측값이 아닙니다.',
    'quantity를 판단할 수 없으면 0, 낱개는 unitLabel을 "개", 조각은 "조각", 그릇은 "그릇", 컵은 "컵"으로 기록하세요.',
    'foodType은 meal, sideDish, fruit, drink 중 하나로 분류하세요. 밥·면 등 주식은 meal, 반찬·국·찌개는 sideDish입니다.',
    '피자는 토핑 종류와 조각 수가 보이면 이름과 quantity에 반영하고, 확실하지 않은 브랜드나 메뉴명은 추측하지 마세요.',
    'confidence는 사진에서 직접 확인 가능한 근거만으로 보수적으로 부여하고, 비슷해 보인다는 이유만으로 0.85 이상을 주지 마세요.',
    '브랜드나 정확한 메뉴를 모르더라도 도넛, 햄버거, 김밥처럼 음식 종류가 보이면 일반 음식명과 0.55~0.75 confidence로 반드시 후보를 반환하세요.',
    '제품 글자가 선명하면 제품명과 브랜드를 사용하고, 손·식기·테이블·배경은 제외하세요.',
    '음식 자체가 전혀 보이지 않을 때만 foods를 빈 배열로 반환하세요. 설명이나 분석 과정은 출력하지 마세요.',
    '유사 사진 검색을 위해 englishName에는 일반적인 영어 음식명 또는 제품명을 짧게 기록하세요.',
    '반드시 JSON만 반환하세요: {"foods":[{"name":"한국어 음식명","englishName":"English food name","brand":"브랜드 또는 빈 문자열","confidence":0부터1,"estimatedGrams":숫자,"quantity":숫자,"unitLabel":"개","foodType":"fruit"}],"reason":"짧은 근거"}',
  ].join('\n');
}

function normalizeUnitLabel(value) {
  const unit = String(value || '').trim();
  return ['개', '조각', '그릇', '컵', '접시', '줌'].includes(unit) ? unit : '';
}

function normalizePosition(value) {
  if (!value || typeof value.x !== 'number' || typeof value.y !== 'number') return null;
  if (![value.x, value.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)) return null;
  return { x: value.x, y: value.y };
}

function normalizeFoodType(value) {
  const type = String(value || '').trim();
  return ['meal', 'sideDish', 'fruit', 'drink'].includes(type) ? type : '';
}

function extractOutputText(payload) {
  return (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => item?.text || '')
    .join('\n');
}

function extractWorkersAiText(payload) {
  if (typeof payload === 'string') return payload;
  if (typeof payload?.result === 'string') return payload.result;
  if (typeof payload?.result?.answer === 'string') return payload.result.answer;
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || '').join('\n');
  }
  return String(payload?.answer || payload?.caption || payload?.response || payload?.result || payload?.description || payload?.output_text || '');
}

function parseJsonObject(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function isAiQuotaError(error) {
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  const message = String(error?.message || error?.cause?.message || error || '').toLowerCase();
  return status === 429 || /quota|rate.?limit|daily.?limit|neurons?|exceeded|too many requests|10006/.test(message);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
