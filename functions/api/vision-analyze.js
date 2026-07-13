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
  let diagnostic = null;

  if (env.AI) {
    try {
      const result = await env.AI.run('@cf/moonshotai/kimi-k2.7-code', {
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
        max_completion_tokens: 350,
        reasoning_effort: 'low',
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });
      outputText = extractWorkersAiText(result);
      if (body?.debug === true) {
        diagnostic = {
          keys: result && typeof result === 'object' ? Object.keys(result) : [],
          preview: JSON.stringify(result).slice(0, 1500),
        };
      }
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
      max_output_tokens: 350,
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
        }))
        .filter((food) => food.name && food.confidence >= 0.72)
        .slice(0, 4)
    : [];

  return json({ ok: true, provider, foods, reason: String(parsed?.reason || '').slice(0, 200), ...(diagnostic ? { diagnostic } : {}) });
}

function createRecognitionPrompt() {
  return [
    '사진에서 실제로 보이는 음식과 음료만 식별하세요.',
    '포장 글자가 보이면 제품명과 브랜드를 우선 사용하세요.',
    '손, 식기, 테이블, 배경은 음식으로 판단하지 마세요.',
    '확실하지 않으면 foods를 빈 배열로 반환하세요.',
    '반드시 JSON만 반환하세요: {"foods":[{"name":"한국어 음식명","brand":"브랜드 또는 빈 문자열","confidence":0부터1,"estimatedGrams":숫자}],"reason":"짧은 근거"}',
  ].join('\n');
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
