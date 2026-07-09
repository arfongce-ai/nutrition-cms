import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeMeal,
  createEmptyFoodItem,
  createEmptyNutritionFacts,
  createEstimatedFoodItem,
  MODE_LABELS,
  parseNutritionText,
} from './services/nutritionEngine';
import { findOfficialBrandFood } from './services/officialNutritionSources';

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
  { label: '스타벅스 아메리카노', name: '스타벅스 카페 아메리카노', grams: '1' },
  { label: '맥도날드 빅맥', name: '맥도날드 빅맥', grams: '1' },
  { label: '버거킹 와퍼', name: '버거킹 와퍼', grams: '1' },
  { label: '써브웨이 BMT', name: '써브웨이 이탈리안비엠티', grams: '1' },
];

const textFoodEstimates = [
  { keys: ['현미밥', '잡곡밥'], name: '현미밥', grams: '150', label: '밥류' },
  { keys: ['흰쌀밥', '쌀밥', '공기밥', '밥'], name: '흰쌀밥', grams: '150', label: '밥류' },
  { keys: ['김치', '배추김치', '깍두기'], name: '배추김치', grams: '50', label: '김치류' },
  { keys: ['된장찌개', '김치찌개', '미역국', '국밥', '찌개'], name: '된장찌개', grams: '220', label: '국/찌개류' },
  { keys: ['닭가슴살', '닭 가슴살', 'chicken breast'], name: '닭가슴살', grams: '120', label: '단백질 반찬' },
  { keys: ['샐러드', 'salad', '채소'], name: '샐러드', grams: '160', label: '채소류' },
  { keys: ['바나나', 'banana'], name: '바나나', grams: '150', label: '과일류' },
  { keys: ['고구마', 'sweet potato'], name: '고구마', grams: '150', label: '탄수화물 식품' },
  { keys: ['계란', '달걀', 'egg'], name: '계란', grams: '60', label: '계란류' },
  { keys: ['두부', 'tofu'], name: '두부', grams: '120', label: '두부류' },
  { keys: ['우유', 'milk'], name: '우유', grams: '200', label: '유제품' },
  { keys: ['프로틴', '웨이', 'protein', 'whey'], name: '웨이 프로틴', grams: '50', label: '단백질 제품' },
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
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [savedReports, setSavedReports] = useState([]);
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
  const showCapturePrompt = cameraReady && !cameraError && !liveReport;

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
      const detected = await readNutritionTextFromCanvas(canvas, textDetectorRef);
      const food = estimateFoodFromCanvas(canvas, detected.text);
      if (!detected.text) {
        setLiveScan((current) => ({
          status: detected.status === 'unsupported' ? 'unsupported' : food ? 'visual' : 'scanning',
          facts: food ? current.facts || {} : {},
          text: food ? current.text || '' : '',
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
        status: food ? 'visual' : 'scanning',
        facts: food ? current.facts || {} : {},
        text: food ? detected.text || current.text || '' : '',
        food,
      }));
    } catch {
      setLiveScan(() => ({
        status: 'scanning',
        facts: {},
        text: '',
        food: null,
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
      foods: liveScan.food ? [liveScan.food] : [],
      facts: initialFacts,
      ocrStatus: hasReadableNutritionFacts(liveScan.facts) ? 'detected' : 'checking',
      ocrText: liveScan.text || '',
    });
    setSaveState('');

    const detected = await readNutritionTextFromImage(photo);
    const visualEstimate = await estimateFoodFromPhoto(photo, detected.text);
    setCaptured((current) => {
      if (!current) return current;
      const shouldApplyVisualEstimate = visualEstimate && (!current.foods.length || (current.foods.length === 1 && current.foods[0]?.estimated));
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
    const { saveNutritionReport, readLocalReports } = await import('./services/reportStore');
    const result = await saveNutritionReport(report);
    setSavedReports(readLocalReports());
    setSaveState(result.storage === 'firebase' ? 'Firebase 저장됨' : '기기 저장됨');
  }

  async function loadSavedReports() {
    const { readLocalReports } = await import('./services/reportStore');
    const reports = readLocalReports();
    setSavedReports(reports);
    return reports;
  }

  async function openDiary() {
    await loadSavedReports();
    setDiaryOpen(true);
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
              {showCapturePrompt ? (
                <div className="absolute -bottom-14 left-1/2 w-max max-w-[82vw] -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-center text-sm font-black text-white/90">
                  음식·성분표를 원 안에 맞춰주세요
                </div>
              ) : null}
            </div>
          </div>

          {showCapturePrompt ? (
            <div className="pointer-events-none absolute inset-x-4 top-1/2 z-10 flex -translate-y-1/2 justify-center">
              <div className="max-w-[88vw] animate-pulse rounded-full border border-white/20 bg-black/55 px-5 py-3 text-center text-lg font-black shadow-2xl backdrop-blur md:text-2xl">
              음식 및 성분표를 촬영하세요
              </div>
            </div>
          ) : null}

          {cameraError ? (
            <div className="absolute bottom-36 left-4 right-4 z-10 rounded-lg border border-amber-400/30 bg-amber-500/15 px-4 py-3 text-center text-sm font-bold text-amber-100">
              {cameraError}
            </div>
          ) : null}

          {cameraReady && !cameraError ? <LiveNutritionBadge liveScan={liveScan} /> : null}
          {cameraReady && !cameraError ? <LiveAnalysisPanel liveReport={liveReport} liveScan={liveScan} /> : null}

          <div className="absolute bottom-8 left-0 right-0 z-10 flex items-center justify-center gap-7">
            <button
              type="button"
              onClick={openDiary}
              className="grid h-16 w-16 place-items-center rounded-full border border-white/25 bg-black/45 text-3xl font-black shadow-2xl backdrop-blur"
              aria-label="오늘 기록 열기"
            >
              ⌂
            </button>
            <button
              type="button"
              onClick={handleShoot}
              className="grid h-24 w-24 place-items-center rounded-full border-[7px] border-white bg-white/15 shadow-2xl"
              aria-label="촬영"
            >
              <span className="block h-16 w-16 rounded-full bg-red-500 shadow-inner" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="grid h-16 w-16 place-items-center rounded-full border border-white/25 bg-black/45 text-3xl shadow-2xl backdrop-blur"
              aria-label="설정 열기"
            >
              ⚙
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
      {diaryOpen ? (
        <DiarySheet
          profile={profile}
          reports={savedReports}
          onRefresh={loadSavedReports}
          onClose={() => setDiaryOpen(false)}
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
          body={report.items.length ? report.items.map(formatReportItemLabel).join(', ') : '촬영 음식 250g 기준 자동 추정'}
        />
        <ReportLine
          title="📊 칼로리 및 주요 영양소"
          body={`${formatMetric(report.totals.calories, 'kcal')} / 탄수화물 ${report.macroPercent.carb}%, 단백질 ${report.macroPercent.protein}%, 지방 ${report.macroPercent.fat}%`}
        />
        {report.sourceItems?.length ? <OfficialSourceList sources={report.sourceItems} /> : null}

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

function formatReportItemLabel(item) {
  if (item.serving) return `${item.name} (${item.serving})`;
  return `${item.name}${item.grams ? ` ${item.grams}g` : ''}`;
}

function OfficialSourceList({ sources }) {
  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
      <h3 className="text-lg font-black">🔎 공식 출처 및 안전 확인</h3>
      <div className="mt-3 grid gap-2">
        {sources.map((source) => (
          <a
            key={`${source.name}-${source.sourceUrl}`}
            href={source.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-teal-100 bg-white p-3 text-sm font-black text-teal-800"
          >
            <span className="block text-xs text-teal-600">{sourceTypeLabel(source)}</span>
            <span>
              {source.name}
              {source.serving ? ` · ${source.serving}` : ''} · {source.sourceLabel}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function sourceTypeLabel(source) {
  if (source.type === 'official-value') return '공식값 적용';
  if (source.type === 'safety-reference') return '알레르기·도핑 안전 확인';
  return '공식 출처 확인';
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
      <div className="absolute left-4 right-4 top-[9.5rem] z-10 rounded-full border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 text-xs font-black text-emerald-50 shadow-xl backdrop-blur md:right-auto md:max-w-[520px]">
        영양표 자동 인식: {preview}
        {extraCount > 0 ? ` 외 ${extraCount}개` : ''}
      </div>
    );
  }

  return null;
}

function LiveAnalysisPanel({ liveReport, liveScan }) {
  if (!liveReport) {
    const unsupported = liveScan?.status === 'unsupported';
    return (
      <div className="absolute left-4 right-4 top-4 z-10 rounded-2xl border border-white/15 bg-black/45 p-3 text-white shadow-2xl backdrop-blur md:left-auto md:right-4 md:w-[360px]">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm font-black">실시간 자동 분석</strong>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${unsupported ? 'bg-amber-300 text-amber-950' : 'bg-white/10 text-white/75'}`}>
            {unsupported ? '제한' : '분석 중'}
          </span>
        </div>
        <p className="mt-1 text-xs font-bold text-white/75">
          {unsupported
            ? '이 브라우저에서는 성분표 자동 문자 인식이 제한됩니다. 촬영 후 숫자를 직접 입력할 수 있습니다.'
            : '성분표를 원 안에 크게 맞추면 확대·대비 보정 후 kcal와 주요 성분을 읽습니다.'}
        </p>
        <p className="mt-2 border-t border-white/10 pt-2 text-[11px] font-black text-amber-100/90">
          정확하지 않을 수 있으니 참고하세요.
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
    <div className="absolute left-4 right-4 top-4 z-10 rounded-2xl border border-white/15 bg-black/55 p-3 text-white shadow-2xl backdrop-blur md:left-auto md:right-4 md:w-[360px]">
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
      <p className="mt-2 border-t border-white/10 pt-2 text-[11px] font-black text-amber-100/90">
        정확하지 않을 수 있으니 참고하세요.
      </p>
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

function DiarySheet({ profile, reports, onRefresh, onClose }) {
  const todayReports = reports.filter(isTodayReport);
  const totals = sumSavedReportTotals(todayReports);
  const dailyGoal = estimateDailyCalorieGoal(profile);
  const remainingCalories = Math.max(0, dailyGoal - Math.round(totals.calories));
  const progress = Math.min(100, Math.round((totals.calories / Math.max(dailyGoal, 1)) * 100));

  return (
    <aside className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur">
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-50 p-5 text-slate-950 shadow-2xl md:left-auto md:right-6 md:top-6 md:w-[560px] md:rounded-2xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-teal-700">오늘 저장된 식단</p>
            <h2 className="text-3xl font-black">기록 홈</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onRefresh} className="h-11 rounded-full bg-white px-4 font-black shadow">
              새로고침
            </button>
            <button type="button" onClick={onClose} className="h-11 rounded-full bg-slate-950 px-5 font-black text-white">
              닫기
            </button>
          </div>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-black text-slate-500">오늘 섭취</p>
              <strong className="text-4xl font-black">{formatMetric(totals.calories, 'kcal')}</strong>
            </div>
            <div className="text-right">
              <p className="text-sm font-black text-slate-500">남은 열량</p>
              <strong className="text-2xl font-black text-teal-700">{formatMetric(remainingCalories, 'kcal')}</strong>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-teal-600" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="단백질" value={formatMetric(totals.protein, 'g')} />
            <Metric label="당류" value={formatMetric(totals.sugar, 'g')} />
            <Metric label="나트륨" value={formatMetric(totals.sodium, 'mg')} />
          </div>
        </section>

        <section className="mt-4 grid gap-3">
          {todayReports.length ? (
            todayReports.map((report) => (
              <article key={`${report.createdAt}-${report.summary}`} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-slate-500">{formatSavedReportTime(report.createdAt)}</p>
                    <h3 className="mt-1 text-lg font-black">{report.summary || '촬영 식단'}</h3>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${stampPillClass(report.stamp)}`}>
                    {report.stamp === 'red' ? '조심' : report.stamp === 'yellow' ? '주의' : '좋음'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Metric label="열량" value={formatMetric(report.totals?.calories, 'kcal')} />
                  <Metric label="탄수" value={formatMetric(report.totals?.carb, 'g')} />
                  <Metric label="지방" value={formatMetric(report.totals?.fat, 'g')} />
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center font-black text-slate-500">
              아직 저장된 식단이 없습니다. 촬영 후 저장을 누르면 여기에 쌓입니다.
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function SettingsSheet({ profile, updateProfile, toggleMedical, onClose }) {
  const [guideOpen, setGuideOpen] = useState(false);

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

        <UserGuideAccordion open={guideOpen} onToggle={() => setGuideOpen((current) => !current)} />

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

function UserGuideAccordion({ open, onToggle }) {
  return (
    <section className="mb-5 border-b border-slate-200 pb-5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm"
        aria-expanded={open}
      >
        <span>
          <strong className="block text-xl font-black">사용설명서</strong>
          <span className="mt-1 block text-sm font-bold text-slate-500">
            처음 사용하는 순서를 접었다 폈다 볼 수 있습니다.
          </span>
        </span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-950 text-xl font-black text-white">
          {open ? '−' : '+'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm font-bold leading-relaxed text-slate-800">
          <ol className="grid gap-2">
            <li>1. 앱을 열면 로그인 없이 바로 카메라가 켜집니다.</li>
            <li>2. 음식이나 식품 영양성분표를 둥근 테두리 안에 맞춥니다.</li>
            <li>3. 가운데 안내가 깜빡이면 분석 준비 중입니다. 음식 후보가 잡히면 안내가 사라집니다.</li>
            <li>4. 위쪽의 실시간 자동 분석 카드에서 예상 열량, 당류, 나트륨을 먼저 확인합니다.</li>
            <li>5. 가운데 빨간 촬영 버튼을 누르면 A4 리포트 카드가 만들어집니다.</li>
            <li>6. 음식명이나 양이 다르면 결과 화면에서 수정한 뒤 저장합니다.</li>
          </ol>
          <p className="mt-3 rounded-lg bg-white p-3 text-xs text-slate-600">
            한식처럼 여러 음식이 함께 있을 때는 자동 추정 후 밥, 국, 김치, 반찬을 필요하면 직접 보정하면 정확도가 올라갑니다.
          </p>
        </div>
      ) : null}
    </section>
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
    return { status: 'unsupported', text: '' };
  }

  try {
    const image = await loadImage(photo);
    const detector = new window.TextDetector();
    const candidates = createOcrCandidateCanvases(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
    const text = await detectBestText(detector, candidates);
    return { status: text ? 'detected' : 'manual', text };
  } catch {
    return { status: 'manual', text: '' };
  }
}

async function readNutritionTextFromCanvas(canvas, detectorRef) {
  if (!canvas || !('TextDetector' in window)) {
    return { status: 'unsupported', text: '' };
  }

  try {
    if (!detectorRef.current) {
      detectorRef.current = new window.TextDetector();
    }
    const candidates = createOcrCandidateCanvases(canvas, canvas.width, canvas.height);
    const text = await detectBestText(detectorRef.current, candidates);
    return { status: text ? 'detected' : 'manual', text };
  } catch {
    return { status: 'manual', text: '' };
  }
}

async function detectBestText(detector, candidates) {
  const lines = [];

  for (const candidate of candidates) {
    try {
      const results = await detector.detect(candidate);
      results
        .map((item) => item.rawValue)
        .filter(Boolean)
        .forEach((line) => lines.push(line));
    } catch {
      // Some devices reject a preprocessed canvas. Keep trying the next candidate.
    }
  }

  return uniqueOcrLines(lines).join('\n');
}

function uniqueOcrLines(lines) {
  const seen = new Set();
  return lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.replace(/\s/g, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function createOcrCandidateCanvases(source, sourceWidth, sourceHeight) {
  const candidates = [];
  const safeWidth = Math.max(1, sourceWidth || 1);
  const safeHeight = Math.max(1, sourceHeight || 1);

  candidates.push(drawScaledCanvas(source, safeWidth, safeHeight, 1600));

  const cropSize = Math.floor(Math.min(safeWidth, safeHeight) * 0.82);
  const cropX = Math.floor((safeWidth - cropSize) / 2);
  const cropY = Math.floor((safeHeight - cropSize) / 2);
  const centerCrop = drawCroppedCanvas(source, cropX, cropY, cropSize, cropSize, 1700, 1700);
  candidates.push(centerCrop);
  candidates.push(createContrastCanvas(centerCrop, { grayscale: true, contrast: 1.45, brightness: 10 }));
  candidates.push(createContrastCanvas(centerCrop, { grayscale: true, contrast: 1.85, brightness: 24, threshold: 146 }));

  const labelWidth = Math.floor(safeWidth * 0.9);
  const labelHeight = Math.floor(safeHeight * 0.45);
  const labelX = Math.floor((safeWidth - labelWidth) / 2);
  const labelY = Math.floor(safeHeight * 0.27);
  const centerBand = drawCroppedCanvas(source, labelX, labelY, labelWidth, labelHeight, 1800, 900);
  candidates.push(centerBand);
  candidates.push(createContrastCanvas(centerBand, { grayscale: true, contrast: 1.65, brightness: 18 }));

  return candidates;
}

function drawScaledCanvas(source, sourceWidth, sourceHeight, maxSide) {
  const scale = Math.min(maxSide / Math.max(sourceWidth, sourceHeight), 2.4);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas;
}

function drawCroppedCanvas(source, x, y, width, height, targetWidth, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, targetWidth);
  canvas.height = Math.max(1, targetHeight);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createContrastCanvas(sourceCanvas, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const contrast = options.contrast || 1;
  const brightness = options.brightness || 0;
  const threshold = options.threshold;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    let value = options.grayscale ? gray : (r + g + b) / 3;
    value = Math.max(0, Math.min(255, (value - 128) * contrast + 128 + brightness));
    if (threshold != null) {
      value = value > threshold ? 255 : 0;
    }
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function estimateFoodFromPhoto(photo, text = '') {
  if (!photo) return null;

  try {
    const image = await loadImage(photo);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    return estimateFoodFromDrawable(image, sourceWidth, sourceHeight, text);
  } catch {
    return null;
  }
}

function estimateFoodFromCanvas(sourceCanvas, text = '') {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return null;
  return estimateFoodFromDrawable(sourceCanvas, sourceCanvas.width, sourceCanvas.height, text);
}

function estimateFoodFromDrawable(source, sourceWidth, sourceHeight, text = '') {
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
  const textEstimate = createFoodEstimateFromText(text);
  const visualEstimate = createFoodEstimateFromColor(colorStats, Boolean(textEstimate));

  if (textEstimate && visualEstimate && textEstimate.name !== visualEstimate.name) {
    return {
      ...textEstimate,
      visualReason: `${textEstimate.visualReason} / 화면 형태 후보: ${visualEstimate.name}`,
    };
  }

  return textEstimate || visualEstimate;
}

function createFoodColorStats(pixels) {
  const stats = { green: 0, yellow: 0, white: 0, brown: 0, total: 0 };
  const gridSize = 8;
  const cellSets = {
    green: new Set(),
    yellow: new Set(),
    white: new Set(),
    brown: new Set(),
  };

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const pixelIndex = index / 4;
    const x = pixelIndex % 64;
    const y = Math.floor(pixelIndex / 64);
    const cell = `${Math.floor(x / gridSize)}-${Math.floor(y / gridSize)}`;
    const brightness = (r + g + b) / 3;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;

    if (brightness < 45 || brightness > 245) continue;
    stats.total += 1;

    if (g > r * 1.08 && g > b * 1.08 && brightness > 55) {
      stats.green += 1;
      cellSets.green.add(cell);
    }
    if (r > 145 && g > 115 && b < 145 && saturation > 0.18) {
      stats.yellow += 1;
      cellSets.yellow.add(cell);
    }
    if (brightness > 175 && saturation < 0.22) {
      stats.white += 1;
      cellSets.white.add(cell);
    }
    if (r > 95 && g > 50 && b < 105 && r > g * 1.1 && saturation > 0.22) {
      stats.brown += 1;
      cellSets.brown.add(cell);
    }
  }

  const total = Math.max(stats.total, 1);
  return {
    total: stats.total,
    green: stats.green / total,
    yellow: stats.yellow / total,
    white: stats.white / total,
    brown: stats.brown / total,
    spread: {
      green: cellSets.green.size / 64,
      yellow: cellSets.yellow.size / 64,
      white: cellSets.white.size / 64,
      brown: cellSets.brown.size / 64,
    },
  };
}

function createFoodEstimateFromText(text) {
  const normalized = normalizeRecognitionText(text);
  if (!normalized) return null;

  const officialFood = findOfficialBrandFood(text);
  if (officialFood) {
    const officialKey = officialFood.keys[0];
    const officialName = normalizeRecognitionText(officialKey).includes(normalizeRecognitionText(officialFood.brand))
      ? officialKey
      : `${officialFood.brand} ${officialKey}`;
    return createVisualEstimatedFood(
      officialName,
      '1',
      `${officialFood.brand} 공식 제품명/브랜드 글자를 인식했어요`,
    );
  }

  const hint = textFoodEstimates.find((entry) => entry.keys.some((key) => normalized.includes(normalizeRecognitionText(key))));
  if (!hint) return null;

  return createVisualEstimatedFood(hint.name, hint.grams, `글자에서 ${hint.label} 단서를 인식했어요`);
}

function createFoodEstimateFromColor(stats, hasTextSignal = false) {
  if (stats.total < 700) return null;
  if (isCompactFoodShape(stats, 'green', hasTextSignal) && stats.green > 0.24) {
    return createVisualEstimatedFood('샐러드', '180', '초록색 채소와 둥근 음식 형태가 함께 보여요');
  }
  if (isCompactFoodShape(stats, 'yellow', hasTextSignal) && stats.yellow > 0.25) {
    return createVisualEstimatedFood('바나나', '150', '노란색 음식 형태가 화면 일부에 모여 보여요');
  }
  if (isCompactFoodShape(stats, 'white', hasTextSignal) && stats.white > 0.34) {
    return createVisualEstimatedFood('흰쌀밥', '150', '밝은 흰색 음식 형태가 화면 일부에 모여 보여요');
  }
  if (isCompactFoodShape(stats, 'brown', hasTextSignal) && stats.brown > 0.28) {
    return createVisualEstimatedFood('닭가슴살', '140', '갈색 단백질 반찬 형태가 화면 일부에 모여 보여요');
  }
  return null;
}

function isCompactFoodShape(stats, key, hasTextSignal) {
  const spread = stats.spread?.[key] || 0;
  const maxSpread = hasTextSignal ? 0.72 : 0.46;
  return spread >= 0.06 && spread <= maxSpread;
}

function createVisualEstimatedFood(name, grams, visualReason) {
  return {
    ...createEstimatedFoodItem(),
    name,
    grams,
    visualReason,
  };
}

function normalizeRecognitionText(value) {
  return String(value || '').toLowerCase().replace(/[\s™®.&·ㆍ_-]/g, '');
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

function isTodayReport(report) {
  const date = new Date(report.createdAt);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function sumSavedReportTotals(reports) {
  return reports.reduce(
    (acc, report) => {
      const totals = report.totals || {};
      acc.calories += Number(totals.calories || 0);
      acc.carb += Number(totals.carb || 0);
      acc.protein += Number(totals.protein || 0);
      acc.fat += Number(totals.fat || 0);
      acc.sodium += Number(totals.sodium || 0);
      acc.sugar += Number(totals.sugar || 0);
      return acc;
    },
    { calories: 0, carb: 0, protein: 0, fat: 0, sodium: 0, sugar: 0 },
  );
}

function estimateDailyCalorieGoal(profile) {
  const weight = Number(profile.weight || DEFAULT_PROFILE.weight);
  const height = Number(profile.height || DEFAULT_PROFILE.height);
  const age = Number(profile.age || DEFAULT_PROFILE.age);
  const sexOffset = profile.gender === '여성' ? -161 : 5;
  const activity = profile.sport && profile.sport !== '없음' ? 1.55 : 1.35;
  const bmr = 10 * weight + 6.25 * height - 5 * age + sexOffset;
  const target = profile.mode === 'adult' ? bmr * activity - 300 : bmr * activity;
  return Math.max(1200, Math.round(target / 50) * 50);
}

function formatSavedReportTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '오늘';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function stampPillClass(stamp) {
  if (stamp === 'red') return 'bg-red-100 text-red-700';
  if (stamp === 'yellow') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
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
