import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeMeal, MODE_LABELS, SCENARIOS } from './services/nutritionEngine';

const PROFILE_KEY = 'nutritionCameraProfile.v1';

const DEFAULT_PROFILE = {
  mode: 'adult',
  age: 32,
  gender: '남성',
  height: 174,
  weight: 72,
  medical: ['없음'],
  sport: '없음',
  scenario: 'balanced',
};

const modeOptions = [
  { id: 'adult', label: '성인' },
  { id: 'child', label: '아동' },
  { id: 'senior', label: '노인' },
];

const medicalOptions = ['없음', '당뇨', '고혈압', '만성신장질환', '이상지질혈증'];

const sportOptions = [
  { id: '없음', label: '일반 식단', hint: '다이어트와 건강 유지' },
  { id: '근력파워', label: '근력·파워', hint: '웨이트, 역도, 보디빌딩' },
  { id: '팀스포츠', label: '팀스포츠', hint: '축구, 농구, 테니스' },
  { id: '지구력', label: '지구력', hint: '마라톤, 사이클, 수영' },
];

const scenarioOptions = [
  { id: 'balanced', label: '현미밥, 닭가슴살 샐러드, 김치' },
  { id: 'highSodium', label: '흰쌀밥, 된장찌개, 배추김치' },
  { id: 'sportsRecovery', label: '바나나, 웨이프로틴, 고구마' },
  { id: 'dopingRisk', label: '해외 직구 부스터, 마황 한약' },
];

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fallbackCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const [profile, setProfile] = useStoredProfile();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [photo, setPhoto] = useState('');
  const [saveState, setSaveState] = useState('');

  const items = useMemo(() => SCENARIOS[profile.scenario] || SCENARIOS.balanced, [profile.scenario]);
  const modeLabel = MODE_LABELS[profile.mode];

  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.body.style.background = '#0f172a';
    startCamera();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    drawFallbackMeal(fallbackCanvasRef.current, profile, items);
  }, [profile, items]);

  async function startCamera() {
    const localHostnames = ['localhost', '127.0.0.1'];
    const isLocalhost = localHostnames.includes(window.location.hostname);

    if (!window.isSecureContext && !isLocalhost) {
      setCameraError('휴대폰 실제 카메라는 HTTPS 주소에서만 켜집니다. 지금은 샘플 화면으로 표시합니다.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('이 브라우저에서는 카메라를 사용할 수 없어 샘플 화면으로 표시합니다.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraReady(true);
      }
    } catch {
      setCameraError('카메라 권한이 없어서 샘플 화면으로 표시합니다.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }

  function capturePhoto() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return '';

    if (cameraReady && video?.videoWidth && video?.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.9);
    }

    drawFallbackMeal(fallbackCanvasRef.current, profile, items);
    return fallbackCanvasRef.current?.toDataURL('image/png') || '';
  }

  function handleShoot() {
    const captured = capturePhoto();
    const analysis = analyzeMeal(profile, items);
    setPhoto(captured);
    setReport(analysis);
    setSaveState('');
    if (profile.mode === 'senior') {
      window.setTimeout(() => speak(analysis.messageText), 350);
    }
  }

  async function handleSave() {
    if (!report) return;
    setSaveState('저장 중');
    const { saveNutritionReport } = await import('./services/reportStore');
    const result = await saveNutritionReport(report);
    setSaveState(result.storage === 'firebase' ? 'Firebase 저장됨' : '기기 저장됨');
  }

  function updateProfile(next) {
    setProfile((current) => ({ ...current, ...next }));
  }

  function toggleMedical(value) {
    setProfile((current) => {
      if (value === '없음') return { ...current, medical: ['없음'] };
      const withoutNone = current.medical.filter((item) => item !== '없음');
      const next = withoutNone.includes(value)
        ? withoutNone.filter((item) => item !== value)
        : [...withoutNone, value];
      return { ...current, medical: next.length ? next : ['없음'] };
    });
  }

  return (
    <main className={`min-h-screen overflow-hidden bg-slate-950 text-slate-50 mode-${profile.mode}`}>
      {!report ? (
        <section className="relative min-h-screen bg-slate-950">
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover ${cameraReady ? 'block' : 'hidden'}`}
            autoPlay
            playsInline
            muted
          />
          <canvas ref={fallbackCanvasRef} width="900" height="1200" className={`absolute inset-0 h-full w-full object-cover ${cameraReady ? 'hidden' : 'block'}`} />
          <canvas ref={canvasRef} className="hidden" />

          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/10 to-black/80" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative h-[min(68vw,430px)] w-[min(68vw,430px)] rounded-full border-2 border-white/80 shadow-[0_0_0_22px_rgba(255,255,255,0.05)]">
              <div className="absolute left-8 right-8 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-emerald-300/90 shadow-[0_0_24px_rgba(52,211,153,0.85)]" />
            </div>
          </div>

          <header className="absolute left-4 right-4 top-5 z-10 flex items-start justify-between gap-3">
            <div className="rounded-full border border-white/20 bg-black/40 px-4 py-3 text-lg font-black shadow-xl backdrop-blur md:text-2xl">
              {profile.mode === 'senior' ? '음식을 비추고 큰 버튼을 눌러주세요' : '오늘 식단을 비추고 촬영하세요'}
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-black/40 text-2xl shadow-xl backdrop-blur"
              aria-label="설정 열기"
            >
              ⚙
            </button>
          </header>

          <div className="absolute inset-0 z-10 pointer-events-none">
            {items.slice(0, 4).map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="absolute rounded-lg border-2 border-emerald-300/80 bg-slate-950/40 px-3 py-2 text-sm font-black shadow-xl backdrop-blur"
                style={tagPosition(index)}
              >
                {item.emoji} {item.name}
              </div>
            ))}
          </div>

          {cameraError ? (
            <div className="absolute bottom-36 left-4 right-4 z-10 rounded-lg border border-amber-400/30 bg-amber-500/15 px-4 py-3 text-center text-sm font-bold text-amber-100">
              {cameraError}
            </div>
          ) : null}

          <div className="absolute bottom-8 left-0 right-0 z-10 flex justify-center">
            <button
              type="button"
              onClick={handleShoot}
              className="grid h-24 w-24 place-items-center rounded-full border-[7px] border-white bg-white/15 shadow-2xl"
              aria-label="촬영"
            >
              <span className="block h-16 w-16 rounded-full bg-red-500 shadow-inner" />
            </button>
          </div>
        </section>
      ) : (
        <ReportView
          report={report}
          photo={photo}
          modeLabel={modeLabel}
          saveState={saveState}
          onBack={() => setReport(null)}
          onSave={handleSave}
          onSpeak={() => speak(report.messageText)}
        />
      )}

      {settingsOpen ? (
        <SettingsSheet
          profile={profile}
          updateProfile={updateProfile}
          toggleMedical={toggleMedical}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </main>
  );
}

function ReportView({ report, photo, modeLabel, saveState, onBack, onSave, onSpeak }) {
  const stampStyles = {
    green: 'border-emerald-500 text-emerald-600',
    yellow: 'border-amber-500 text-amber-600',
    red: 'border-red-500 text-red-600',
  };
  const stampLabel = {
    green: '참 잘했어요',
    yellow: '생각해요',
    red: '조심해요',
  }[report.stamp];

  return (
    <section className="min-h-screen overflow-y-auto bg-slate-200 px-3 py-20 text-slate-950">
      <div className="fixed left-3 right-3 top-4 z-20 flex justify-between">
        <button type="button" onClick={onBack} className="h-12 rounded-full bg-white px-5 font-black shadow-lg">
          다시 촬영
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onSpeak} className="h-12 rounded-full bg-white px-4 font-black shadow-lg">
            음성
          </button>
          <button type="button" onClick={onSave} className="h-12 rounded-full bg-slate-950 px-5 font-black text-white shadow-lg">
            {saveState || '저장'}
          </button>
        </div>
      </div>

      <article className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-[900px] flex-col gap-6 rounded-md bg-[#fffdf8] p-5 shadow-2xl md:aspect-[210/297] md:p-10">
        <header className="flex items-start justify-between gap-4 border-b-4 border-slate-950 pb-5">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">KDRI 기반 식단 리포트</p>
            <h1 className="mt-1 text-4xl font-black tracking-tight md:text-6xl">{modeLabel} A4 알림장</h1>
          </div>
          <div className={`grid aspect-square w-28 rotate-[-8deg] place-items-center rounded-full border-[7px] text-center text-xl font-black leading-tight md:w-40 ${stampStyles[report.stamp]}`}>
            {stampLabel}
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
          <img src={photo} alt="촬영된 식단" className="h-72 w-full rounded-lg border border-slate-200 object-cover md:h-full" />
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-2xl font-black">분석된 항목</h2>
            <p className="mt-3 text-xl font-black leading-relaxed">
              {report.items.map((item) => `${item.emoji} ${item.name}`).join(' · ')}
            </p>
            {report.profile.mode === 'adult' ? (
              <dl className="mt-5 grid grid-cols-2 gap-3">
                <Metric label="에너지" value={`${Math.round(report.totals.calories)} kcal`} />
                <Metric label="탄단지" value={`${Math.round(report.totals.carb)} / ${Math.round(report.totals.protein)} / ${Math.round(report.totals.fat)}g`} />
                <Metric label="나트륨" value={`${Math.round(report.totals.sodium)} mg`} />
                <Metric label="류신" value={`${Math.round(report.totals.leucine)} mg`} />
              </dl>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/80 p-5">
          <h2 className="text-2xl font-black">오늘의 건강 및 안전 도장</h2>
          <p className="mt-3 text-2xl font-black leading-snug">{report.stampText}</p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white/80 p-5">
          <h2 className="text-2xl font-black">맞춤 알림장 한마디</h2>
          <div className={`mt-4 grid gap-3 font-bold leading-relaxed ${report.profile.mode === 'senior' ? 'text-3xl' : 'text-xl'}`}>
            {report.messageParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>
      </article>
    </section>
  );
}

function SettingsSheet({ profile, updateProfile, toggleMedical, onClose }) {
  return (
    <aside className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur">
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-50 p-5 text-slate-950 shadow-2xl md:left-auto md:right-6 md:top-6 md:w-[520px] md:rounded-2xl">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-teal-700">카메라 분석 설정</p>
            <h2 className="text-3xl font-black">설정</h2>
          </div>
          <button type="button" onClick={onClose} className="h-11 rounded-full bg-slate-950 px-5 font-black text-white">
            완료
          </button>
        </header>

        <SettingBlock title="사용자 모드">
          <div className="grid grid-cols-3 gap-2">
            {modeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => updateProfile({ mode: option.id })}
                className={`h-14 rounded-lg border font-black ${profile.mode === option.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </SettingBlock>

        <SettingBlock title="신체 정보">
          <RangeField label="연령" value={profile.age} min={6} max={90} unit="세" onChange={(age) => updateProfile({ age })} />
          <RangeField label="키" value={profile.height} min={110} max={210} unit="cm" onChange={(height) => updateProfile({ height })} />
          <RangeField label="몸무게" value={profile.weight} min={20} max={150} unit="kg" onChange={(weight) => updateProfile({ weight })} />
          <label className="grid gap-2 font-black">
            성별
            <select value={profile.gender} onChange={(event) => updateProfile({ gender: event.target.value })} className="h-12 rounded-lg border border-slate-200 bg-white px-3">
              <option value="남성">남성</option>
              <option value="여성">여성</option>
            </select>
          </label>
        </SettingBlock>

        <SettingBlock title="건강 상태">
          <div className="grid grid-cols-2 gap-2">
            {medicalOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => toggleMedical(option)}
                className={`min-h-12 rounded-lg border px-3 font-black ${profile.medical.includes(option) ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white'}`}
              >
                {option === '없음' ? '건강해요' : option}
              </button>
            ))}
          </div>
        </SettingBlock>

        <SettingBlock title="운동 목적">
          <div className="grid gap-2">
            {sportOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => updateProfile({ sport: option.id })}
                className={`rounded-lg border p-4 text-left ${profile.sport === option.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white'}`}
              >
                <strong className="block text-lg">{option.label}</strong>
                <span className="text-sm opacity-75">{option.hint}</span>
              </button>
            ))}
          </div>
        </SettingBlock>

        <SettingBlock title="촬영 분석 샘플">
          <div className="grid gap-2">
            {scenarioOptions.map((option) => (
              <label key={option.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 font-bold">
                <input
                  type="radio"
                  name="scenario"
                  checked={profile.scenario === option.id}
                  onChange={() => updateProfile({ scenario: option.id })}
                  className="h-5 w-5 accent-teal-700"
                />
                {option.label}
              </label>
            ))}
          </div>
        </SettingBlock>
      </div>
    </aside>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-100 p-3">
      <dt className="text-xs font-black text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-black">{value}</dd>
    </div>
  );
}

function SettingBlock({ title, children }) {
  return (
    <section className="border-t border-slate-200 py-5">
      <h3 className="mb-3 text-xl font-black">{title}</h3>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function RangeField({ label, value, min, max, unit, onChange }) {
  return (
    <label className="grid gap-2 font-black">
      <span className="flex justify-between">
        {label}
        <output className="text-teal-700">
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-teal-700"
      />
    </label>
  );
}

function useStoredProfile() {
  const [profile, setProfileState] = useState(() => {
    try {
      return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') };
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  function setProfile(updater) {
    setProfileState((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return [profile, setProfile];
}

function drawFallbackMeal(canvas, profile, items) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const palette = profile.mode === 'child' ? ['#ffd5de', '#fff0a6', '#bce6d5'] : ['#dfeee7', '#fff6d6', '#f2c6b6'];

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, '#1c2b2d');
  bg.addColorStop(1, '#45535a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, 90, 190, 720, 840, 42);
  ctx.fill();

  ctx.fillStyle = '#f7fbf2';
  ctx.beginPath();
  ctx.ellipse(450, 620, 320, 248, 0, 0, Math.PI * 2);
  ctx.fill();

  items.slice(0, 4).forEach((item, index) => {
    const [x, y, radius] = [
      [332, 560, 145],
      [532, 548, 135],
      [430, 725, 128],
      [575, 720, 108],
    ][index] || [450, 620, 120];
    ctx.fillStyle = palette[index % palette.length];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#172026';
    ctx.font = '700 72px Segoe UI Emoji, Apple Color Emoji, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.emoji.replace('⚠️', '⚠'), x, y - 10);
  });

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '900 46px Pretendard, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${MODE_LABELS[profile.mode]} 식단 촬영`, 450, 110);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function tagPosition(index) {
  return [
    { left: '22%', top: '38%' },
    { left: '54%', top: '45%' },
    { left: '39%', top: '58%' },
    { left: '61%', top: '34%' },
  ][index] || { left: '42%', top: '50%' };
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}
