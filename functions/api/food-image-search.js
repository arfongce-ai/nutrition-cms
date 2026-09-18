const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'public, max-age=3600',
};

export function onRequestOptions() {
  return new Response(null, { headers: jsonHeaders });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim();
  const limit = clamp(Number(url.searchParams.get('limit') || 4), 1, 6);

  if (!query || query.length > 120) {
    return json({ ok: false, query, images: [], message: '1~120자의 음식명이 필요합니다.' }, 400);
  }

  const endpoint = new URL('https://api.openverse.org/v1/images/');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('page_size', String(limit));
  endpoint.searchParams.set('category', 'photograph');
  endpoint.searchParams.set('mature', 'false');
  endpoint.searchParams.set('unstable__authority', 'true');

  try {
    const response = await fetch(endpoint, {
      headers: {
        accept: 'application/json',
        'user-agent': 'MOMGAGYM nutrition visual reference search',
      },
    });

    if (!response.ok) {
      return json({ ok: false, query, images: [], message: '유사 사진 검색이 잠시 지연되고 있습니다.' }, 502);
    }

    const payload = await response.json();
    const images = (Array.isArray(payload?.results) ? payload.results : [])
      .filter((image) => image?.thumbnail && image?.foreign_landing_url && !image?.mature)
      .slice(0, limit)
      .map((image) => ({
        id: String(image.id || ''),
        title: String(image.title || query).slice(0, 160),
        thumbnailUrl: String(image.thumbnail || ''),
        sourceUrl: String(image.foreign_landing_url || ''),
        creator: String(image.creator || '저작자 미상').slice(0, 100),
        license: String(image.license || '').toUpperCase(),
        licenseUrl: String(image.license_url || ''),
        attribution: String(image.attribution || '').slice(0, 300),
        provider: String(image.provider || image.source || 'Openverse'),
      }));

    return json({ ok: true, query, images });
  } catch (error) {
    console.error('Openverse image search failed', error);
    return json({ ok: false, query, images: [], message: '유사 사진 검색에 연결하지 못했습니다.' }, 502);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
