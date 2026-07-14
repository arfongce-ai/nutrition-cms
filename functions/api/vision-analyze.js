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

  if (env.AI) {
    try {
      const result = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
        messages: [
          { role: 'system', content: '당신은 음식 사진 판별기입니다. 반드시 요청한 JSON 형식만 반환합니다.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: createRecognitionPrompt() },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        max_completion_tokens: 700,
        reasoning_effort: 'low',
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });
      outputText = extractWorkersAiText(result);
      provider = 'cloudflare-workers-ai';
    } catch (error) {
      console.error('Cloudflare Workers AI vision failed', error);
      if (!env.OPENAI_API_KEY) {
        return json({ ok: false, code: 'vision_provider_error', message: 'Cloudflare 비전 분석에 실패했습니다.' }, 502);
      }
    }
  }

  if (!outputText && env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
      max_output_tokens: 450,
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
      return json({ ok: false, code: 'vision_provider_error', message: '비전 분석 요청에 실패했습니다.' }, 502);
    }

    const payload = await response.json();
    outputText = extractOutputText(payload);
    provider = 'openai';
  }

  const parsed = parseJsonObject(outputText);
  const foods = Array.isArray(parsed?.foods)
    ? parsed.foods
        .map((food) => ({
          name: String(food?.name || '').trim(),
          brand: String(food?.brand || '').trim(),
          confidence: clamp(Number(food?.confidence || 0), 0, 1),
          estimatedGrams: clamp(Number(food?.estimatedGrams || 0), 0, 5000),
          quantity: clamp(Math.round(Number(food?.quantity || 0)), 0, 100),
          unitLabel: normalizeUnitLabel(food?.unitLabel),
          foodType: normalizeFoodType(food?.foodType),
        }))
        .filter((food) => food.name && food.confidence >= 0.72)
        .slice(0, 8)
    : [];

  return json({ ok: true, provider, foods, reason: String(parsed?.reason || '').slice(0, 200) });
}

function createRecognitionPrompt() {
  return [
    '사진의 전경에서 실제로 보이는 음식, 반찬, 과일 또는 음료를 빠짐없이 각각 식별하세요.',
    '한식 한 상처럼 여러 그릇이나 반찬이 있으면 서로 다른 음식을 foods 배열의 별도 항목으로 최대 8가지까지 반환하세요.',
    '국, 찌개처럼 그릇에 담긴 국물 요리는 건더기 질감이나 국물 표면의 반사광을 과자 봉지·비닐 포장지로 착각하지 말고 조리된 국물 요리로 분류하세요.',
    '같은 종류의 과일이나 달걀처럼 낱개로 셀 수 있으면 한 항목으로 묶고 보이는 개수를 quantity에 정수로 기록하세요.',
    'estimatedGrams는 한 개 무게가 아니라 화면에 보이는 해당 음식 전체의 섭취 가능 중량 합계로 추정하세요. 총 칼로리 계산에 우선 사용됩니다.',
    'quantity를 판단할 수 없으면 0, 낱개는 unitLabel을 "개", 조각은 "조각", 그릇은 "그릇", 컵은 "컵"으로 기록하세요.',
    'foodType은 meal, sideDish, fruit, drink 중 하나로 분류하세요. 밥·면 등 주식은 meal, 반찬·국·찌개는 sideDish입니다.',
    '피자는 토핑 종류와 조각 수가 보이면 이름과 quantity에 반영하고, 확실하지 않은 브랜드나 메뉴명은 추측하지 마세요.',
    'confidence는 사진에서 직접 확인 가능한 근거만으로 보수적으로 부여하고, 비슷해 보인다는 이유만으로 0.85 이상을 주지 마세요.',
    '제품 글자가 선명하면 제품명과 브랜드를 사용하고, 손·식기·테이블·배경은 제외하세요.',
    '확실하지 않으면 foods를 빈 배열로 반환하세요. 설명이나 분석 과정은 출력하지 마세요.',
    '반드시 JSON만 반환하세요: {"foods":[{"name":"한국어 음식명","brand":"브랜드 또는 빈 문자열","confidence":0부터1,"estimatedGrams":숫자,"quantity":숫자,"unitLabel":"개","foodType":"fruit"}],"reason":"짧은 근거"}',
  ].join('\n');
}

function normalizeUnitLabel(value) {
  const unit = String(value || '').trim();
  return ['개', '조각', '그릇', '컵', '접시', '줌'].includes(unit) ? unit : '';
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
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || '').join('\n');
  }
  return String(payload?.response || payload?.result || payload?.description || payload?.output_text || '');
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
