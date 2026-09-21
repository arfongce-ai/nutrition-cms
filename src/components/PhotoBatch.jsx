import { useEffect, useState } from 'react';
import { localDateTime, mealTypeAt } from '../services/diaryInsights.js';
import { readPhotoTiming } from '../services/photoTiming.js';

export default function PhotoBatch({ files, onStart, onClose }) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('사진의 촬영 시간을 읽고 있어요…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const urls = files.map((file) => URL.createObjectURL(file));
    Promise.all(files.map(async (file, i) => ({ file, preview: urls[i], id: i, ...await readPhotoTiming(file) }))).then((next) => {
      if (active) { setRows(next); setMessage('촬영 시간은 식사 시간과 다를 수 있어요. 사진별 날짜·시간과 식사 구분을 확인하세요.'); }
    });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [files]);
  function update(id, values) { setRows((old) => old.map((row) => row.id === id ? { ...row, ...values } : row)); }
  async function start(e) {
    e.preventDefault();
    if (!rows.length || rows.some((r) => !r.timeConfirmed || !r.dateTime || !Number.isFinite(new Date(r.dateTime).getTime()) || new Date(r.dateTime) > new Date())) { setMessage('모든 사진의 실제 식사 시간을 확인해 주세요. 미래 시간은 저장할 수 없어요.'); return; }
    setBusy(true);
    try { await onStart([...rows].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))); }
    catch { setMessage('사진을 열지 못했어요. JPG·PNG·WebP 사진으로 다시 시도해 주세요.'); setBusy(false); }
  }
  return <aside className="meal-screen photo-batch" role="dialog" aria-modal="true" aria-labelledby="batch-title"><form className="meal-page" onSubmit={start}>
    <header className="meal-header"><button className="meal-back" type="button" disabled={busy} onClick={onClose}>← 취소</button><span className="meal-brand">한 번에 올리고, 한 끼씩 저장</span></header>
    <div className="meal-page-title"><p>하루 사진 한 번에 올리기</p><h1 id="batch-title">언제 먹은 사진인가요?</h1><p>사진 {rows.length || files.length}장 · 시간순으로 정리해요</p></div>
    <p className="meal-notice" role="status">{message}</p>
    {rows.map((row, index) => <section className="meal-card batch-row" key={row.id}><img src={row.preview} alt={`선택한 식사 ${index + 1}`} /><div><h2>{index + 1}. {row.file.name}</h2><p className="meal-hint">{row.timeSource === 'exif' ? '사진 촬영 시간에서 가져옴 · 기기 현지 시간' : '촬영 시간 없음 · 현재 시간을 임시로 넣었어요'}</p><label className="meal-field">식사 날짜와 시간<input type="datetime-local" required max={localDateTime()} value={row.dateTime} onChange={(e) => update(row.id, { dateTime: e.target.value, timeConfirmed: true, mealType: mealTypeAt(e.target.value) })} /></label><label className="meal-field">식사 구분<select value={row.mealType} onChange={(e) => update(row.id, { mealType: e.target.value })}>{['아침', '점심', '저녁', '간식·기타'].map((v) => <option key={v}>{v}</option>)}</select></label><label className="journal-complete"><input type="checkbox" checked={row.timeConfirmed} onChange={(e) => update(row.id, { timeConfirmed: e.target.checked })} />이 식사 시간이 맞아요</label><button className="meal-back" type="button" disabled={busy} onClick={() => setRows((old) => old.filter((r) => r.id !== row.id))}>목록에서 빼기</button></div></section>)}
    <p className="meal-hint">사진 한 장을 한 식사로 저장해요. 같은 식사를 여러 장 찍었다면 중복된 사진을 빼주세요. 다음 단계에서 음식과 양을 한 끼씩 확인합니다.</p>
    <button className="meal-primary" disabled={busy || !rows.length} type="submit">{busy ? '첫 사진을 열고 있어요…' : `${rows.length}장 시간순으로 기록 시작`}</button>
  </form></aside>;
}
