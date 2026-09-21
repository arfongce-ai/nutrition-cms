// src/AppGate.jsx
// ════════════════════════════════════════════════════════════════════════
//  App(카메라 화면) 앞단에서 "회원 연결 + 이용권한"을 확인하는 문지기.
//  App.jsx 자체는 건드리지 않는다 — 기존 카메라·분석 로직을 깨뜨릴 위험을
//  최소화하기 위해 완전히 분리된 래퍼로 구현했다(요청 스펙 "현재 영양 앱
//  기능을 깨뜨리지 않는다").
//
//  ⚠️ 중요 — 기본값은 "게이트 꺼짐"이다. 지금까지 이 앱은 로그인·회원가입
//  없이 누구나 바로 카메라로 들어가는 구조였다(README: "로그인 화면과
//  대시보드 없이 앱을 열면 바로 식단 촬영 카메라로 진입"). 이 커밋 하나로
//  그 동작을 전체 사용자에게 강제로 바꿔버리면 "기존 기능을 깨뜨리지 않는다"
//  원칙과 정면으로 부딪힌다. 그래서 VITE_REQUIRE_MEMBER_LINK=true를 명시
//  설정해야만 연결 화면이 뜨고, 설정하지 않으면 지금처럼 바로 App이 뜬다.
//  센터가 실제로 회원 연결을 의무화할 준비가 되면(트레이너 교육, 연결코드
//  발급 절차 안내 등) 이 환경변수를 켜면 된다 — 운영 배포는 대표님이 별도로
//  결정.
//
//  게이트가 켜져 있을 때의 상태 전이:
//   연결 없음        → ConnectScreen(연결코드 입력)
//   연결됨 + 확인 중  → CheckingScreen
//   연결됨 + 이용가능 → <App/>
//   연결됨 + 이용불가  → LockedScreen(사유별 안내 문구)
//   오프라인(재확인 실패) → LockedScreen(OFFLINE) — "네트워크 없으면 앱을 열지 않는다"
//
//  포그라운드 복귀(visibilitychange) 시 재확인 — 요청 스펙 섹션 5.
//
//  화면 스타일은 App.jsx의 나머지 화면(meal-screen/meal-page/meal-card 등,
//  src/styles/index.css)과 같은 클래스를 그대로 쓴다 — 별도 다크 테마를
//  만들지 않는다(이 앱은 라이트 테마다).
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import App from './App.jsx';
import { getConnection, exchangeLinkCode } from './services/nutritionLink';
import { checkEligibility } from './services/sessionGuard';

const GATE_ENABLED = import.meta.env.VITE_REQUIRE_MEMBER_LINK === 'true';

function ConnectScreen({ onConnected }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await exchangeLinkCode(code);
      onConnected();
    } catch (e) {
      setError(e.message || '연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="meal-screen">
      <div className="meal-page">
        <div className="meal-page-title">
          <p>몸가짐 센터 회원 연결</p>
          <h1>연결코드를 입력해주세요</h1>
          <p>센터 트레이너에게 8자리 연결코드를 받아 입력하세요.</p>
        </div>
        <form onSubmit={submit}>
          <section className="meal-card">
            <label className="meal-field">
              연결코드
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="예: AB12CD34"
                style={{ textAlign: 'center', letterSpacing: '0.25em', fontSize: '20px', fontWeight: 800 }}
                autoFocus
              />
            </label>
            {error ? <p className="meal-hint" role="alert">{error}</p> : null}
          </section>
          <button type="submit" disabled={busy || code.length < 8} className="meal-primary">
            {busy ? '연결 중…' : '연결하기'}
          </button>
        </form>
      </div>
    </main>
  );
}

function LockedScreen({ message, onRetry }) {
  return (
    <main className="meal-screen">
      <div className="meal-page">
        <div className="meal-page-title">
          <h1>이용할 수 없습니다</h1>
        </div>
        <div className="meal-card meal-empty">
          <span aria-hidden="true">🔒</span>
          <h2>{message || '이용기간이 종료되었습니다.'}</h2>
          <p>계속 이용하려면 몸가짐 센터에 문의해 주세요.</p>
          <button type="button" onClick={onRetry} className="meal-secondary">다시 확인</button>
        </div>
      </div>
    </main>
  );
}

function CheckingScreen() {
  return (
    <main className="meal-screen">
      <div className="meal-page">
        <div className="meal-card meal-empty">
          <p>이용권한 확인 중…</p>
        </div>
      </div>
    </main>
  );
}

export default function AppGate() {
  // GATE_ENABLED는 모듈 로드 시 한 번 고정되는 값이라 렌더 사이에 절대 안 바뀌지만,
  // Hooks 규칙(조건부 이전에 hook 호출 금지)을 지키기 위해 훅은 항상 최상단에서
  // 호출하고, 분기는 각 훅 콜백 안이나 return 문에서만 한다.
  const [phase, setPhase] = useState('checking'); // 'checking' | 'connect' | 'locked' | 'ready'
  const [lockMessage, setLockMessage] = useState('');

  const runCheck = async () => {
    if (!getConnection()) {
      setPhase('connect');
      return;
    }
    setPhase('checking');
    const result = await checkEligibility({ force: true });
    if (result.eligible) {
      setPhase('ready');
    } else {
      setLockMessage(result.message);
      setPhase(result.code === 'NOT_CONNECTED' ? 'connect' : 'locked');
    }
  };

  useEffect(() => {
    if (!GATE_ENABLED) return undefined;
    runCheck();
    const onVisible = () => {
      if (document.visibilityState === 'visible') runCheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GATE_ENABLED) return <App />;
  if (phase === 'connect') return <ConnectScreen onConnected={runCheck} />;
  if (phase === 'locked') return <LockedScreen message={lockMessage} onRetry={runCheck} />;
  if (phase === 'ready') return <App />;
  return <CheckingScreen />;
}
