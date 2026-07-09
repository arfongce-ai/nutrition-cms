import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeMeal,
  createEmptyFoodItem,
  createEmptyNutritionFacts,
  createEstimatedFoodItem,
  MODE_LABELS,
  parseNutritionText,
} from './services/nutritionEngine';

const PROFILE_KEY = 'nutritionCameraProfile.v2';
const LIVE_NUTRIENT_SCAN_INTERVAL_MS = 1800;

const nutritionFactFields = [
  { key: 'calories', label: '열량', unit: 'kcal' },
  { key: 'carb', label: '탄수', unit: 'g' },
  { key: 'protein', label: '단백질', unit: 'g' },
  { key: 'fat', label: '지방', unit: 'g' },
  { key: 'sugar', label: '당류', unit: 'g' },
  { key: 'sodium', label: '나트륨', unit: 'mg' },
];

const foodCorrectionPresets = [
  { label: '밥 반 공기', name: '흰쌀밥', grams: '105' },
  { label: '밥 한 공기', name: '흰쌀밥', grams: '210' },
  { label: '국/찌개 조금', name: '된장찌개', grams: '180' },
  { label: '국/찌개 보통', name: '된장찌개', grams: '300' },
  { label: '김치 조금', name: '배추김치', grams: '30' },
  { label: '김치 보통', name: '배추김치', grams: '60' },
  { label: '고기반찬', name: '닭가슴살', grams: '120' },
  { label: '채소/나물', name: '샐러드', grams: '100' },
  { label: '바나나/과일', name: '바나나', grams: '150' },
  { label: '고구마', name: '고구마', grams: '150' },
  { label: '단백질 제품', name: '웨이 프로틴', grams: '50' },
];

const DEFAULT_PROFILE = {
  mode: 'adult',
  age: 32,
  gender: '남성',
  height: 174,
  weight: 72,
  medical: ['없음'],
  sport: '없음',
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

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fallbackCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const textDetectorRef = useRef(null);
  const liveScanTimerRef = useRef(null);
  const liveScanBusyRef = useRef(false);
  const [profile, setProfile] = useStoredProfile();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captured, setCaptured] = useState(null);
  const [liveScan, setLiveScan] = useState({ status: 'idle', facts: {}, text: '' });
  const [saveState, setSaveState] = useState('');

  const report = useMemo(() => {
    if (!captured) return null;
    return analyzeMeal(profile, captured.foods, captured.facts, {
      ocrStatus: captured.ocrStatus,
      ocrText: captured.ocrText,
    });
  }, [captured, profile]);

  const liveReport = useMemo(() => {
    const liveFoods = liveScan.food ? [liveScan.food] : [];
    if (captured || (!liveFoods.length && !hasReadableNutritionFacts(liveScan.facts))) return null;
    return analyzeMeal(profile, liveFoods, liveScan.facts, {
      ocrStatus: liveScan.status,
      ocrText: liveScan.text,
      skipMissingFoodRisk: true,
    });
  }, [captured, liveScan, profile]);

  const modeLabel = MODE_LABELS[profile.mode];

  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.body.style.background = '#0f172a';
    startCamera();
    return () => {
      stopLiveNutrientScan();
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!cameraReady) {
      drawFallbackGuide(fallbackCanvasRef.current);
    }
  }, [cameraReady]);

  useEffect(() => {
    if (!cameraReady || captured || settingsOpen || cameraError) {
      stopLiveNutrientScan();
      return undefined;
    }

    startLiveNutrientScan();
    return () => stopLiveNutrientScan();
  }, [cameraReady, captured, settingsOpen, cameraError]);

  useEffect(() => {
    if (!captured && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      setCameraReady(true);
    }
  }, [captured]);

  async function startCamera() {
    const localHostnames = ['localhost', '127.0.0.1'];
    const isLocalhost = localHostnames.includes(window.location.hostname);

    if (!window.isSecureContext && !isLocalhost) {
      setCameraError('휴대폰 카메라는 HTTPS 주소에서만 켜집니다. Cloudflare Pages 주소로 열어주세요.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('이 브라우저에서는 카메라를 사용할 수 없습니다. Chrome에서 다시 열어주세요.');
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
        setCameraError('');
      }
    } catch {
      setCameraError('카메라 권한이 필요합니다. 브라우저 주소창의 카메라 권한을 허용해주세요.');
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

    drawFallbackGuide(fallbackCanvasRef.current);
    return fallbackCanvasRef.current?.toDataURL('image/png') || '';
  }

  function stopLiveNutrientScan() {
    if (liveScanTimerRef.current) {
      window.clearInterval(liveScanTimerRef.current);
      liveScanTimerRef.current = null;
    }
    liveScanBusyRef.current = false;
  }

  function startLiveNutrientScan() {
    stopLiveNutrientScan();

    setLiveScan((current) => ({ ...current, status: current.status === 'detected' ? 'detected' : 'scanning' }));
    runLiveNutrientScan();
    liveScanTimerRef.current = window.setInterval(runLiveNutrientScan, LIVE_NUTRIENT_SCAN_INTERVAL_MS);
  }

  async function runLiveNutrientScan() {
    if (liveScanBusyRef.current || !cameraReady || captured || settingsOpen) return;

    const canvas = drawLiveFrameForText();
    if (!canvas) return;

    liveScanBusyRef.current = true;
    try {
      const food = estimateFoodFromCanvas(canvas);
      const detected = await readNutritionTextFromCanvas(canvas, textDetectorRef);
      if (!detected.text) {
        setLiveScan((current) => ({
          status: hasReadableNutritionFacts(current.facts) ? 'detected' : 'visual',
          facts: current.facts || {},
          text: current.text || '',
          food,
        }));
        return;
      }

      const facts = parseNutritionText(detected.text);
      if (hasReadableNutritionFacts(facts)) {
        setLiveScan((current) => ({
          status: 'detected',
          facts: {
            ...current.facts,
            ...facts,
          },
          text: detected.text || current.text,
          food,
        }));
        return;
      }

      setLiveScan((current) => ({
        status: hasReadableNutritionFacts(current.facts) ? 'detected' : 'visual',
        facts: current.facts || {},
        text: detected.text || current.text || '',
        food,
      }));
    } catch {
      setLiveScan((current) => ({
        status: hasReadableNutritionFacts(current.facts) ? 'detected' : 'visual',
        facts: current.facts || {},
        text: current.text || '',
        food: current.food || createEstimatedFoodItem(),
      }));
    } finally {
      liveScanBusyRef.current = false;
    }
  }

  function drawLiveFrameForText() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video?.videoWidth || !video?.videoHeight) return null;

    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function handleShoot() {
    const photo = capturePhoto();
    const initialFacts = {
      ...createEmptyNutritionFacts(),
      ...liveScan.facts,
    };
    setCaptured({
      photo,
      foods: [liveScan.food || createEstimatedFoodItem()],
      facts: initialFacts,
      ocrStatus: hasReadableNutritionFacts(liveScan.facts) ? 'detected' : 'checking',
      ocrText: liveScan.text || '',
    });
    setSaveState('');

    const [detected, visualEstimate] = await Promise.all([readNutritionTextFromImage(photo), estimateFoodFromPhoto(photo)]);
    setCaptured((current) => {
      if (!current) return current;
      const shouldApplyVisualEstimate = visualEstimate && current.foods.length === 1 && current.foods[0]?.estimated;
      const nextFoods = shouldApplyVisualEstimate ? [visualEstimate] : current.foods;

      return {
        ...current,
        foods: nextFoods,
        ocrStatus: detected.text ? 'detected' : hasReadableNutritionFacts(current.facts) ? 'detected' : detected.status,
        ocrText: detected.text || current.ocrText,
        facts: detected.text
          ? {
              ...current.facts,
              ...parseNutritionText(detected.text),
            }
          : current.facts,
      };
    });
  }

  function handleRetake() {
    setCaptured(null);
    setSaveState('');
    setLiveScan({ status: 'scanning', facts: {}, text: '', food: null });

    const hasLiveTrack = streamRef.current?.getVideoTracks?.().some((track) => track.readyState === 'live');
    if (!hasLiveTrack) {
      setCameraReady(false);
      startCamera();
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

  function updateFacts(next) {
    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        facts: {
          ...current.facts,
          ...next,
        },
      };
    });
  }

  function updateFood(id, next) {
    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        foods: current.foods.map((food) => (food.id === id ? { ...food, ...next } : food)),
      };
    });
  }

  function addFood() {
    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        foods: [...current.foods, createEmptyFoodItem()],
      };
    });
  }

  function removeFood(id) {
    setCaptured((current) => {
      if (!current) return current;
      const nextFoods = current.foods.filter((food) => food.id !== id);
      return {
        ...current,
        foods: nextFoods.length ? nextFoods : [createEmptyFoodItem()],
      };
    });
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

          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/5 to-black/80" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative h-[min(74vw,430px)] w-[min(74vw,430px)] rounded-full border-2 border-white/85 shadow-[0_0_0_22px_rgba(255,255,255,0.05)]">
              <div className="absolute left-[22%] right-[22%] top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-emerald-300/90 shadow-[0_0_24px_rgba(52,211,153,0.85)]" />
              <div className="absolute -bottom-14 left-1/2 w-max max-w-[82vw] -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-center text-sm font-black text-white/90">
                음식·성분표를 원 안에 맞춰주세요
              </div>
            </div>
          </div>

          <header className="absolute left-4 right-4 top-5 z-10 flex items-start justify-between gap-3">
            <div className="rounded-full border border-white/20 bg-black/45 px-4 py-3 text-lg font-black shadow-xl backdrop-blur md:text-2xl">
              음식 및 성분표를 촬영하세요
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-black/45 text-2xl shadow-xl backdrop-blur"
              aria-label="설정 열기"
            >
              ⚙
            </button>
          </header>

          {cameraError ? (
            <div className="absolute bottom-36 left-4 right-4 z-10 rounded-lg border border-amber-400/30 bg-amber-500/15 px-4 py-3 text-center text-sm font-bold text-amber-100">
              {cameraError}
            </div>
          ) : null}

          {cameraReady && !cameraError ? <LiveNutritionBadge liveScan={liveScan} /> : null}
          {cameraReady && !cameraError ? <LiveAnalysisPanel liveReport={liveReport} liveScan={liveScan} /> : null}

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
          captured={captured}
          modeLabel={modeLabel}
          report={report}
          saveState={saveState}
          updateFood={updateFood}
          addFood={addFood}
          removeFood={removeFood}
          updateFacts={updateFacts}
          onBack={handleRetake}
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

function ReportView({ captured, modeLabel, report, saveState, updateFood, addFood, removeFood, updateFacts, onBack, onSave, onSpeak }) {
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
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">KDRI 기반 음식·영양표 분석</p>
            <h1 className="mt-1 text-4xl font-black tracking-tight md:text-6xl">{modeLabel} A4 카드</h1>
          </div>
          <div className={`grid aspect-square w-28 rotate-[-8deg] place-items-center rounded-full border-[7px] text-center text-xl font-black leading-tight md:w-40 ${stampStyles[report.stamp]}`}>
            {stampLabel}
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-[0.85fr_1.15fr]">
          <img src={captured.photo} alt="촬영된 음식" className="h-72 w-full rounded-lg border border-slate-200 object-cover md:h-full" />
          <div className="grid gap-4">
            <div className="rounded-lg border-2 border-slate-950 bg-white p-5">
              <h2 className="text-2xl font-black">음식 분석</h2>
              <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                사진만 찍어도 자동 추정값으로 바로 분석합니다. 정확도를 높이고 싶을 때만 음식명과 양을 수정하세요.
              </p>
              <FoodItemsForm foods={captured.foods} updateFood={updateFood} addFood={addFood} removeFood={removeFood} />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-xl font-black">식품 영양표 함께 분석</h2>
              <p className="mt-2 rounded-lg bg-slate-100 p-3 text-sm font-bold text-slate-600">
                {statusText(captured.ocrStatus)}
              </p>
              <NutritionFactsForm facts={captured.facts} updateFacts={updateFacts} />
            </div>
          </div>
        </section>

        <CoachReportCard report={report} />
      </article>
    </section>
  );
}

function CoachReportCard({ report }) {
  const traffic = createTrafficFeedback(report);
  const coachLine = createCoachLine(report);

  return (
    <section className="rounded-lg border-2 border-slate-950 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-teal-700">3단계 AI 메디-스포츠 영양 분석</p>
          <h2 className="mt-1 text-3xl font-black">A4 리포트 카드</h2>
        </div>
        <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white">{traffic.badge}</span>
      </div>

      <div className="mt-5 grid gap-4">
        <ReportLine
          title="🍽️ 인식 음식 및 중량"
          body={report.items.length ? report.items.map((item) => `${item.name}${item.grams ? ` ${item.grams}g` : ''}`).join(', ') : '촬영 음식 250g 기준 자동 추정'}
        />
        <ReportLine
          title="📊 칼로리 및 주요 영양소"
          body={`${formatMetric(report.totals.calories, 'kcal')} / 탄수화물 ${report.macroPercent.carb}%, 단백질 ${report.macroPercent.protein}%, 지방 ${report.macroPercent.fat}%`}
        />

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-lg font-black">🚦 맞춤형 식단 평가</h3>
          <div className="mt-3 grid gap-2">
            <TrafficLine color="green" label="초록 (안전/적절)" text={traffic.green} />
            <TrafficLine color="yellow" label="노랑 (주의/모니터링)" text={traffic.yellow} />
            <TrafficLine color="red" label="빨강 (경고/제한)" text={traffic.red} />
          </div>
        </div>

        <ReportLine title="💡 코치의 한 줄 처방" body={coachLine} strong />
      </div>
    </section>
  );
}

function ReportLine({ title, body, strong = false }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-lg font-black">{title}</h3>
      <p className={`mt-2 leading-relaxed ${strong ? 'text-xl font-black text-teal-800' : 'font-bold text-slate-700'}`}>{body}</p>
    </div>
  );
}

function TrafficLine({ color, label, text }) {
  const styles = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    yellow: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div className={`rounded-lg border p-3 ${styles[color]}`}>
      <strong className="block text-sm">{label}</strong>
      <span className="mt-1 block text-sm font-bold leading-snug">{text}</span>
    </div>
  );
}

function LiveNutritionBadge({ liveScan }) {
  const detectedFacts = getDetectedFactLabels(liveScan?.facts);

  if (detectedFacts.length) {
    const preview = detectedFacts.slice(0, 3).join(' · ');
    const extraCount = detectedFacts.length - 3;
    return (
      <div className="absolute left-4 right-4 top-[6.7rem] z-10 rounded-full border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 text-xs font-black text-emerald-50 shadow-xl backdrop-blur md:right-auto md:max-w-[520px]">
        영양표 자동 인식: {preview}
        {extraCount > 0 ? ` 외 ${extraCount}개` : ''}
      </div>
    );
  }

  return null;
}

function LiveAnalysisPanel({ liveReport, liveScan }) {
  if (!liveReport) {
    return (
      <div className="absolute left-4 right-4 top-36 z-10 rounded-2xl border border-white/15 bg-black/45 p-3 text-white shadow-2xl backdrop-blur md:left-auto md:right-4 md:w-[360px]">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm font-black">실시간 자동 분석</strong>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/75">
            분석 중
          </span>
        </div>
        <p className="mt-1 text-xs font-bold text-white/75">
          음식은 바로 추정하고, 성분표 숫자가 보이면 kcal와 주요 성분도 함께 반영합니다.
        </p>
      </div>
    );
  }

  const stamp = {
    green: { label: '좋음', className: 'bg-emerald-400 text-emerald-950' },
    yellow: { label: '주의', className: 'bg-amber-300 text-amber-950' },
    red: { label: '조심', className: 'bg-red-400 text-red-950' },
  }[liveReport.stamp];

  const primaryRisk = liveScan?.food?.visualReason
    ? `실시간 후보: ${liveScan.food.name} · ${liveScan.food.visualReason}`
    : liveReport.risk.red[0] || liveReport.risk.yellow[0] || '현재 화면 기준으로 큰 위험 신호는 없습니다.';

  return (
    <div className="absolute left-4 right-4 top-36 z-10 rounded-2xl border border-white/15 bg-black/55 p-3 text-white shadow-2xl backdrop-blur md:left-auto md:right-4 md:w-[360px]">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-black">실시간 자동 분석</strong>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${stamp.className}`}>{stamp.label}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <LiveMetric label="열량" value={formatMetric(liveReport.totals.calories, 'kcal')} />
        <LiveMetric label="당류" value={formatMetric(liveReport.totals.sugar, 'g')} />
        <LiveMetric label="나트륨" value={formatMetric(liveReport.totals.sodium, 'mg')} />
      </div>
      <p className="mt-2 text-xs font-bold leading-snug text-white/85">{primaryRisk}</p>
    </div>
  );
}

function LiveMetric({ label, value }) {
  return (
    <div className="rounded-xl bg-white/10 p-2">
      <div className="text-[11px] font-black text-white/60">{label}</div>
      <div className="mt-0.5 text-sm font-black">{value}</div>
    </div>
  );
}

function FoodItemsForm({ foods, updateFood, addFood, removeFood }) {
  return (
    <div className="mt-4 grid gap-3">
      {foods.map((food, index) => (
        <div key={food.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm font-black text-slate-600">음식 {index + 1}</strong>
            <div className="flex items-center gap-2">
              {food.estimated ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">자동 추정</span>
              ) : null}
              {foods.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeFood(food.id)}
                  className="h-8 rounded-full bg-slate-200 px-3 text-xs font-black text-slate-700"
                >
                  삭제
                </button>
              ) : null}
            </div>
          </div>
          {food.estimated ? (
            <div className="grid gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-sm font-black text-emerald-800">
                {food.visualReason ? `사진 후보: ${food.visualReason}` : '자동 추정값으로 먼저 계산했습니다.'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {foodCorrectionPresets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => updateFood(food.id, { name: preset.name, grams: preset.grams, estimated: false, visualReason: '' })}
                    className="min-h-10 rounded-lg border border-emerald-200 bg-white px-2 text-xs font-black text-slate-800"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="grid gap-1 text-sm font-black">
            음식명
            <input
              value={food.name}
              onChange={(event) => updateFood(food.id, { name: event.target.value, estimated: false, visualReason: '' })}
              className="h-12 rounded-lg border border-slate-200 bg-white px-3 text-base"
              placeholder="예: 현미밥, 닭가슴살, 김치"
            />
          </label>
          <label className="grid gap-1 text-sm font-black">
            먹은 양
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
              <input
                value={food.grams}
                inputMode="decimal"
                onChange={(event) => updateFood(food.id, { grams: event.target.value, estimated: false, visualReason: '' })}
                className="h-12 min-w-0 flex-1 px-3 text-base outline-none"
                placeholder="100"
              />
              <span className="grid w-14 place-items-center bg-slate-100 text-xs text-slate-500">g</span>
            </div>
          </label>
        </div>
      ))}

      <button
        type="button"
        onClick={addFood}
        className="h-12 rounded-lg border-2 border-dashed border-slate-300 bg-white font-black text-slate-700"
      >
        음식 추가
      </button>
    </div>
  );
}

function NutritionFactsForm({ facts, updateFacts }) {
  return (
    <div className="mt-4 grid gap-3">
      <p className="rounded-lg bg-teal-50 p-3 text-sm font-black text-teal-800">
        성분표 사진을 찍으면 가능한 숫자는 자동 반영됩니다. 자동 인식이 안 되면 kcal, 탄수화물, 단백질, 지방, 나트륨 숫자만 입력해도 음식 분석과 함께 계산됩니다.
      </p>
      <label className="grid gap-1 text-sm font-black">
        식품명
        <input
          value={facts.foodName}
          onChange={(event) => updateFacts({ foodName: event.target.value })}
          className="h-11 rounded-lg border border-slate-200 px-3 text-base"
          placeholder="예: 단백질바, 도시락, 음료"
        />
      </label>
      <label className="grid gap-1 text-sm font-black">
        1회 제공량
        <input
          value={facts.servingSize}
          onChange={(event) => updateFacts({ servingSize: event.target.value })}
          className="h-11 rounded-lg border border-slate-200 px-3 text-base"
          placeholder="예: 1봉 50g"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <NumberFact label="열량" unit="kcal" value={facts.calories} onChange={(value) => updateFacts({ calories: value })} />
        <NumberFact label="나트륨" unit="mg" value={facts.sodium} onChange={(value) => updateFacts({ sodium: value })} />
        <NumberFact label="탄수화물" unit="g" value={facts.carb} onChange={(value) => updateFacts({ carb: value })} />
        <NumberFact label="당류" unit="g" value={facts.sugar} onChange={(value) => updateFacts({ sugar: value })} />
        <NumberFact label="단백질" unit="g" value={facts.protein} onChange={(value) => updateFacts({ protein: value })} />
        <NumberFact label="지방" unit="g" value={facts.fat} onChange={(value) => updateFacts({ fat: value })} />
        <NumberFact label="포화지방" unit="g" value={facts.saturatedFat} onChange={(value) => updateFacts({ saturatedFat: value })} />
        <NumberFact label="트랜스지방" unit="g" value={facts.transFat} onChange={(value) => updateFacts({ transFat: value })} />
      </div>
    </div>
  );
}

function NumberFact({ label, unit, value, onChange }) {
  return (
    <label className="grid gap-1 text-sm font-black">
      {label}
      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
        <input
          value={value}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 px-3 text-base outline-none"
          placeholder="0"
        />
        <span className="grid w-14 place-items-center bg-slate-100 text-xs text-slate-500">{unit}</span>
      </div>
    </label>
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

function createTrafficFeedback(report) {
  const green = [];
  const hasFood = report.foods.length > 0;

  if (hasFood) green.push('촬영 음식과 추정 중량을 기준으로 총열량과 탄·단·지 비율을 계산했습니다.');
  if (report.totals.protein > 15) green.push('단백질 섭취가 포함되어 근육 유지와 회복에 도움이 됩니다.');
  if (report.totals.sodium < 900) green.push('현재 추정 나트륨은 한 끼 기준에서 과도하지 않습니다.');
  if (!green.length) green.push('촬영값을 기준으로 식단 평가를 시작할 수 있습니다.');

  return {
    badge: report.stamp === 'red' ? '빨강 경고' : report.stamp === 'yellow' ? '노랑 주의' : '초록 적절',
    green: green.slice(0, 2).join(' '),
    yellow: report.risk.yellow.length ? report.risk.yellow.join(', ') : '현재 큰 주의 항목은 없습니다. 후보 음식이 다르면 버튼으로 보정하세요.',
    red: report.risk.red.length ? report.risk.red.join(', ') : '기저질환 관련 즉시 제한 경고는 감지되지 않았습니다.',
  };
}

function createCoachLine(report) {
  const medical = report.profile.medical || [];
  const has = (keyword) => medical.some((item) => String(item).includes(keyword));

  if (report.risk.red.length) {
    return `${report.risk.red[0]} 항목을 먼저 줄이고, 섭취 전 음식명과 양을 한 번 더 확인하세요.`;
  }

  if (has('고혈압') || report.totals.sodium >= 900) {
    return '다음 식사에서는 국물과 김치류를 줄이고 물을 충분히 마셔 나트륨 부담을 낮추세요.';
  }

  if (has('당뇨') || report.totals.sugar >= 15) {
    return '다음 식사는 단 음료보다 단백질 반찬과 채소를 먼저 선택해 혈당 부담을 줄이세요.';
  }

  if (report.profile.sport === '근력파워') {
    return '운동 후 2시간 안에는 단백질 반찬과 탄수화물을 함께 보충해 회복을 이어가세요.';
  }

  if (report.profile.sport === '지구력') {
    return '장시간 운동 전후에는 탄수화물과 수분을 함께 보충해 에너지 고갈을 막으세요.';
  }

  if (report.profile.sport === '팀스포츠') {
    return '반복적인 움직임을 위해 다음 식사에는 밥, 과일, 수분을 함께 챙기세요.';
  }

  if (report.macroPercent.protein < 10 && report.totals.calories > 0) {
    return '다음 식사에는 계란, 두부, 닭가슴살 같은 단백질 반찬을 하나 추가하세요.';
  }

  return '현재 식사는 자동 추정 기준으로 무난합니다. 다음 식사에는 채소와 단백질을 함께 유지하세요.';
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

async function readNutritionTextFromImage(photo) {
  if (!photo || !('TextDetector' in window)) {
    return { status: 'manual', text: '' };
  }

  try {
    const image = await loadImage(photo);
    const detector = new window.TextDetector();
    const results = await detector.detect(image);
    const text = results.map((item) => item.rawValue).filter(Boolean).join('\n');
    return { status: text ? 'detected' : 'manual', text };
  } catch {
    return { status: 'manual', text: '' };
  }
}

async function readNutritionTextFromCanvas(canvas, detectorRef) {
  if (!canvas || !('TextDetector' in window)) {
    return { status: 'manual', text: '' };
  }

  try {
    if (!detectorRef.current) {
      detectorRef.current = new window.TextDetector();
    }
    const results = await detectorRef.current.detect(canvas);
    const text = results.map((item) => item.rawValue).filter(Boolean).join('\n');
    return { status: text ? 'detected' : 'manual', text };
  } catch {
    return { status: 'manual', text: '' };
  }
}

async function estimateFoodFromPhoto(photo) {
  if (!photo) return createEstimatedFoodItem();

  try {
    const image = await loadImage(photo);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    return estimateFoodFromDrawable(image, sourceWidth, sourceHeight);
  } catch {
    return createEstimatedFoodItem();
  }
}

function estimateFoodFromCanvas(sourceCanvas) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return createEstimatedFoodItem();
  return estimateFoodFromDrawable(sourceCanvas, sourceCanvas.width, sourceCanvas.height);
}

function estimateFoodFromDrawable(source, sourceWidth, sourceHeight) {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cropSize = Math.floor(Math.min(sourceWidth, sourceHeight) * 0.76);
  const sourceX = Math.floor((sourceWidth - cropSize) / 2);
  const sourceY = Math.floor((sourceHeight - cropSize) / 2);

  ctx.drawImage(source, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

  const pixels = ctx.getImageData(0, 0, size, size).data;
  const colorStats = createFoodColorStats(pixels);
  return createFoodEstimateFromColor(colorStats);
}

function createFoodColorStats(pixels) {
  const stats = { green: 0, yellow: 0, white: 0, brown: 0, total: 0 };

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const brightness = (r + g + b) / 3;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;

    if (brightness < 45 || brightness > 245) continue;
    stats.total += 1;

    if (g > r * 1.08 && g > b * 1.08 && brightness > 55) stats.green += 1;
    if (r > 145 && g > 115 && b < 145 && saturation > 0.18) stats.yellow += 1;
    if (brightness > 175 && saturation < 0.22) stats.white += 1;
    if (r > 95 && g > 50 && b < 105 && r > g * 1.1 && saturation > 0.22) stats.brown += 1;
  }

  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, key === 'total' ? value : value / Math.max(stats.total, 1)]));
}

function createFoodEstimateFromColor(stats) {
  if (stats.green > 0.18) return createVisualEstimatedFood('샐러드', '180', '초록색 채소 비율이 높아요');
  if (stats.yellow > 0.12) return createVisualEstimatedFood('바나나', '150', '노란색 과일 후보로 보여요');
  if (stats.white > 0.22) return createVisualEstimatedFood('흰쌀밥', '150', '밝은 흰색 음식 후보로 보여요');
  if (stats.brown > 0.16) return createVisualEstimatedFood('닭가슴살', '140', '갈색 단백질 반찬 후보로 보여요');
  return createVisualEstimatedFood('일반 식사', '250', '대표 식사값으로 먼저 계산했어요');
}

function createVisualEstimatedFood(name, grams, visualReason) {
  return {
    ...createEstimatedFoodItem(),
    name,
    grams,
    visualReason,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawFallbackGuide(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, '#111827');
  bg.addColorStop(1, '#334155');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.82)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(450, 500, 245, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '900 42px Pretendard, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('음식 및 성분표 촬영', 450, 500);

  ctx.font = '700 26px Pretendard, Segoe UI, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText('카메라 권한을 허용하면 식단을 바로 촬영할 수 있습니다', 450, 555);
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

function statusText(status) {
  if (status === 'checking') return '음식은 자동 분석 중입니다. 성분표 숫자가 보이면 함께 반영합니다.';
  if (status === 'detected') return '성분표에서 읽은 값이 일부 입력되었습니다. 음식 분석과 함께 합산됩니다.';
  return '자동 인식이 안 되면 성분표 숫자를 직접 입력해 음식 분석과 함께 계산할 수 있습니다.';
}

function hasReadableNutritionFacts(facts) {
  return nutritionFactFields.some((field) => hasFactValue(facts, field.key));
}

function getDetectedFactLabels(facts) {
  return nutritionFactFields
    .filter((field) => hasFactValue(facts, field.key))
    .map((field) => `${field.label} ${facts[field.key]} ${field.unit}`);
}

function hasFactValue(facts, key) {
  return String(facts?.[key] ?? '').trim() !== '';
}

function formatMetric(value, unit) {
  const numeric = Number(value || 0);
  if (!numeric) return '-';
  return `${Math.round(numeric * 10) / 10} ${unit}`;
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}
