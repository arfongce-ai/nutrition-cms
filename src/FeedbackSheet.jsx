// src/FeedbackSheet.jsx
// ════════════════════════════════════════════════════════════════════════
//  선생님 피드백 읽기/답변 화면. DiarySheet와 같은 전체화면 시트 패턴
//  (role="dialog", meal-screen/meal-page/meal-card)을 그대로 따른다 —
//  App.jsx의 useSheetDialog는 App.jsx 내부 비공개 함수라 이 파일에서
//  가져올 수 없으므로, Esc 닫기·바디 스크롤 잠금만 가벼운 버전으로 자체
//  구현한다.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import { fetchMyFeedback, markFeedbackRead, replyToFeedback } from './services/nutritionFeedback';

function useLightSheetDialog(onClose) {
  const closeButtonRef = useRef(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return closeButtonRef;
}

const TYPE_LABEL = {
  NUTRITION_GUIDANCE: '영양 습관 안내',
  MEAL_CHECK: '식사 확인',
  FOLLOW_UP: '다음 상담 확인',
  ENCOURAGEMENT: '격려',
};

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

function FeedbackItem({ item, onRead, onReply }) {
  const [replyText, setReplyText] = useState(item.reply || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item.readAt) onRead(item.feedbackId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.feedbackId]);

  const submitReply = async (event) => {
    event.preventDefault();
    if (!replyText.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onReply(item.feedbackId, replyText.trim());
    } catch (e) {
      setError(e.message || '답변을 보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="meal-card diary-meal-card">
      <div className="meal-card-heading">
        <div>
          <h3>{item.teacherDisplayName || '담당 선생님'}</h3>
          <p>{TYPE_LABEL[item.type] || '피드백'} · {formatDateTime(item.createdAt)}{item.date ? ` · ${item.date}` : ''}</p>
        </div>
      </div>
      <p className="meal-hint">{item.message}</p>
      {item.reply ? (
        <p className="meal-success">내 답변: {item.reply}</p>
      ) : (
        <form onSubmit={submitReply} className="meal-field">
          답변 남기기
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            placeholder="선생님께 전할 말을 적어주세요"
            style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--line, #dce7df)', padding: '10px 12px', font: 'inherit' }}
          />
          {error ? <span role="alert" className="meal-hint">{error}</span> : null}
          <button type="submit" className="meal-secondary" disabled={busy || !replyText.trim()}>
            {busy ? '보내는 중…' : '답변 보내기'}
          </button>
        </form>
      )}
    </article>
  );
}

export default function FeedbackSheet({ onClose }) {
  const closeButtonRef = useLightSheetDialog(onClose);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [items, setItems] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const load = async () => {
    setStatus('loading');
    try {
      const feedback = await fetchMyFeedback();
      setItems(feedback);
      setStatus('ready');
    } catch (e) {
      setErrorMessage(e.message || '피드백을 불러오지 못했습니다.');
      setStatus('error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRead = async (feedbackId) => {
    try {
      await markFeedbackRead(feedbackId);
      setItems((current) => current.map((it) => (it.feedbackId === feedbackId ? { ...it, readAt: it.readAt || new Date().toISOString() } : it)));
    } catch {
      // 읽음 처리 실패는 조용히 무시 — 다음 진입 때 다시 시도됨
    }
  };

  const handleReply = async (feedbackId, reply) => {
    await replyToFeedback(feedbackId, reply);
    setItems((current) => current.map((it) => (it.feedbackId === feedbackId ? { ...it, reply, repliedAt: new Date().toISOString() } : it)));
  };

  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="meal-screen meal-diary">
      <div className="meal-page">
        <header className="meal-header">
          <button ref={closeButtonRef} type="button" className="meal-back" onClick={onClose}>← 닫기</button>
          <button type="button" className="meal-back" onClick={load}>새로고침</button>
        </header>
        <div className="meal-page-title">
          <p>담당 선생님이 남긴 기록</p>
          <h1 id="feedback-title">선생님 피드백</h1>
        </div>
        {status === 'loading' ? <div className="meal-card meal-empty"><p>불러오는 중…</p></div> : null}
        {status === 'error' ? (
          <div className="meal-card meal-empty">
            <span aria-hidden="true">⚠️</span>
            <h2>피드백을 불러오지 못했어요</h2>
            <p role="alert">{errorMessage}</p>
            <button type="button" className="meal-secondary" onClick={load}>다시 시도</button>
          </div>
        ) : null}
        {status === 'ready' && items.length === 0 ? (
          <div className="meal-card meal-empty">
            <span aria-hidden="true">💬</span>
            <h2>아직 받은 피드백이 없어요</h2>
            <p>선생님이 피드백을 남기면 여기에서 확인할 수 있어요.</p>
          </div>
        ) : null}
        {status === 'ready' ? items.map((item) => (
          <FeedbackItem key={item.feedbackId} item={item} onRead={handleRead} onReply={handleReply} />
        )) : null}
      </div>
    </aside>
  );
}
