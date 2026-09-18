const WHO_URL = 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet';
const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const MAX_AGE = 15 * 60 * 1000;

async function checkedFetch(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(9000), headers: { Accept: 'application/json, text/html' } });
  if (!response.ok) throw new Error(`source_http_${response.status}`);
  return response;
}

export function parseWhoGuide(html) {
  const rawDate = html.match(/"dateModified"\s*:\s*"([^\"]+)"/)?.[1] || html.match(/"datePublished"\s*:\s*"([^\"]+)"/)?.[1];
  const date = rawDate?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/Healthy diet/i.test(html)) throw new Error('source_format_changed');
  return [{ id: 'who-healthy-diet', title: '건강한 식사: 영양 균형과 식품 다양성', url: WHO_URL, publishedAt: date, kind: '공식 가이드', publisher: 'WHO', description: '탄수화물·단백질·지방과 비타민·무기질을 다루는 공식 안내입니다. 원문은 영어입니다.' }];
}

export async function fetchPubMed(fetcher = fetch, now = new Date()) {
  const end = now.toISOString().slice(0, 10).replaceAll('-', '/');
  const term = `("dietary intake"[Title/Abstract] OR "diet quality"[Title/Abstract] OR "healthy diet"[Title/Abstract] OR "sports nutrition"[Title/Abstract] OR "protein intake"[Title/Abstract] OR hydration[Title/Abstract]) AND (systematic review[Publication Type] OR meta-analysis[Publication Type]) AND ("${now.getUTCFullYear() - 1}/01/01"[Date - Publication] : "${end}"[Date - Publication]) NOT (retracted publication[Publication Type] OR retraction of publication[Publication Type])`;
  const searchUrl = `${NCBI_BASE}esearch.fcgi?${new URLSearchParams({ db: 'pubmed', term, sort: 'pub_date', retmax: '5', retmode: 'json', tool: 'momgagym_nutrition' })}`;
  const data = await (await checkedFetch(searchUrl, fetcher)).json();
  const ids = data.esearchresult?.idlist;
  if (!Array.isArray(ids) || data.error) throw new Error('source_format_changed');
  if (!ids.length) return [];
  const safeIds = ids.filter((id) => /^\d+$/.test(id));
  if (!safeIds.length) throw new Error('source_format_changed');
  const detail = await (await checkedFetch(`${NCBI_BASE}esummary.fcgi?${new URLSearchParams({ db: 'pubmed', id: safeIds.join(','), retmode: 'json', tool: 'momgagym_nutrition' })}`, fetcher)).json();
  if (!detail.result || detail.error) throw new Error('source_format_changed');
  const entries = safeIds.map((id) => detail.result[id]);
  if (entries.some((entry) => !entry?.title || entry.error)) throw new Error('source_format_changed');
  return entries.map((entry) => ({ id: `pubmed-${entry.uid}`, title: entry.title.replace(/<[^>]*>/g, ''),
    url: `https://pubmed.ncbi.nlm.nih.gov/${entry.uid}/`, publishedAt: entry.epubdate || entry.pubdate || '', kind: '연구 · 체계적 문헌고찰/메타분석', publisher: entry.fulljournalname || entry.source || 'PubMed', description: '최신 색인 연구의 원문 제목입니다. 연구 결과가 개인에게 적용되는 식사 권고를 뜻하지는 않습니다.' }));
}

export async function collectNutritionUpdates(fetcher = fetch, now = new Date()) {
  const results = await Promise.allSettled([
    checkedFetch(WHO_URL, fetcher).then((r) => r.text()).then(parseWhoGuide),
    fetchPubMed(fetcher, now),
  ]);
  const definitions = [{ id: 'who', name: 'WHO 공식 가이드', url: WHO_URL }, { id: 'pubmed', name: 'NIH·NLM PubMed 영양 연구', url: 'https://pubmed.ncbi.nlm.nih.gov/' }];
  return { checkedAt: now.toISOString(), intervalMinutes: 15, sources: results.map((result, i) => ({ ...definitions[i],
    status: result.status === 'fulfilled' ? 'fresh' : 'unavailable',
    checkedAt: result.status === 'fulfilled' ? now.toISOString() : null,
    items: result.status === 'fulfilled' ? result.value : [],
    ...(result.status === 'rejected' ? { error: '공식 출처에 연결하지 못했어요. 잠시 후 다시 확인합니다.' } : {}),
  })) };
}

export async function onRequestGet(context) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(new URL('/api/nutrition-updates', context.request.url));
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const data = await cached.json();
        if (Date.now() - Date.parse(data.checkedAt) < MAX_AGE) return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
      }
    } catch { /* A cache outage must not hide the source response. */ }
  }
  const data = await collectNutritionUpdates();
  const result = Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  if (cache && data.sources.some((source) => source.status === 'fresh')) {
    const write = cache.put(cacheKey, Response.json(data, { headers: { 'Cache-Control': 'public, max-age=900' } })).catch(() => {});
    if (context.waitUntil) context.waitUntil(write); else await write;
  }
  return result;
}
