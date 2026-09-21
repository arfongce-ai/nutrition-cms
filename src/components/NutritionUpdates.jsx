import { useEffect, useRef, useState } from 'react';

const KEY = 'nutritionOfficialUpdates.v1';
const INTERVAL = 15 * 60 * 1000;
function readCache() { try { const data = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(data?.sources) ? data : null; } catch { return null; } }
function when(value) { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR') : '확인 기록 없음'; }
const allowed = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && ['www.who.int', 'pubmed.ncbi.nlm.nih.gov'].includes(u.hostname); } catch { return false; } };

export default function NutritionUpdates() {
  const [data, setData] = useState(readCache);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  async function refresh() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    const timer = setTimeout(() => abort.abort(), 25000);
    try {
      const response = await fetch('/api/nutrition-updates', { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const fresh = await response.json();
      if (!Array.isArray(fresh.sources) || !fresh.checkedAt) throw new Error('invalid');
      if (controller.current !== abort || abort.signal.aborted) return;
      setData((previous) => {
        const next = { ...fresh, sources: fresh.sources.map((source) => {
          const old = previous?.sources.find((s) => s.id === source.id);
          return source.status === 'unavailable' && old?.items?.length ? { ...old, status: 'stale', error: source.error } : source;
        }) };
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Feed is still usable without persistence. */ }
        return next;
      });
    } catch { if (controller.current === abort) setError('최신 자료를 확인하지 못했어요. 저장된 자료는 마지막 확인 시점의 내용입니다.'); }
    finally { clearTimeout(timer); if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  useEffect(() => {
    void refresh();
    const check = () => { if (!document.hidden) void refresh(); };
    const interval = setInterval(check, INTERVAL);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', check); controller.current?.abort(); controller.current = null; };
  }, []);
  return <section className="meal-card nutrition-updates"><div className="meal-total-heading"><h2>최신 영양 자료</h2><button className="meal-back" type="button" disabled={busy} onClick={refresh}>{busy ? '확인 중…' : '지금 확인'}</button></div>
    <p className="meal-hint">이 화면을 보는 동안 15분마다 확인해요. 출처의 공개·색인 일정에 따라 반영되며, 서버의 확인 결과는 최대 15분간 공유됩니다.</p>
    {error ? <p role="status" className="meal-notice">{error}</p> : null}
    {data?.sources.map((source) => <div className="update-source" key={source.id}><h3>{source.name} <small>{busy ? '최신 여부 확인 중' : error || source.status !== 'fresh' ? '최신 확인 실패' : Date.now() - Date.parse(source.checkedAt) > INTERVAL ? '저장된 자료 · 재확인 필요' : '연결 확인'}</small></h3><p className="meal-hint">마지막 성공 확인: {when(source.checkedAt)}</p>
      {source.status !== 'fresh' ? <p className="meal-hint">{source.error}</p> : null}
      {source.items?.length ? source.items.filter((item) => allowed(item.url)).map((item) => <article key={item.id}><span>{item.kind} · {item.publishedAt || '발행일 미표시'}</span><a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a><p>{item.publisher} · {item.description}</p></article>) : <p className="meal-hint">{source.status === 'fresh' ? '검색 조건에 맞는 최근 자료가 없어요.' : '자료를 가져오지 못했어요.'} {allowed(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">공식 출처 열기 ↗</a> : null}</p>}
    </div>)}
    {!data ? <p className="meal-hint">공식 자료 연결을 기다리는 중이에요. <a href="https://www.who.int/news-room/fact-sheets/detail/healthy-diet" target="_blank" rel="noreferrer">WHO 원문 보기 ↗</a></p> : null}
  </section>;
}
