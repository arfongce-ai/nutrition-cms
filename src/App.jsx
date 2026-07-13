import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeMeal,
  createEmptyFoodItem,
  createEmptyNutritionFacts,
  createEstimatedFoodItem,
  MODE_LABELS,
  parseNutritionText,
} from './services/nutritionEngine';
import { OFFICIAL_BRAND_FOODS, findOfficialBrandFood, findOfficialNutritionSources } from './services/officialNutritionSources';
import { findOfficialProductFood, findOfficialProductSources, searchOfficialProductFoods } from './services/officialProductDatabase';

const PROFILE_KEY = 'nutritionCameraProfile.v2';
const CAMERA_PERMISSION_KEY = 'nutritionCameraPermission.v1';
const LIVE_NUTRIENT_SCAN_INTERVAL_MS = 1800;
const FOOD_FOCUS_CROP_RATIO = 0.58;
const LIVE_SCAN_HOLD_FRAMES = 2;
const CAPTURE_JPEG_QUALITY = 0.94;
const LIVE_OCR_FRAME_MAX_WIDTH = 1400;
const MIN_TRUSTED_CAMERA_ESTIMATE_SCORE = 0.7;
const MIN_TEXT_CAMERA_ESTIMATE_SCORE = 0.78;

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
  { label: '방울토마토 8개', name: '방울토마토', grams: '140' },
  { label: '삶은 계란 1개', name: '계란', grams: '50' },
  { label: '삶은 계란 2개', name: '계란', grams: '100' },
  { label: '국/찌개 조금', name: '된장찌개', grams: '180' },
  { label: '국/찌개 보통', name: '된장찌개', grams: '300' },
  { label: '김치 조금', name: '배추김치', grams: '30' },
  { label: '김치 보통', name: '배추김치', grams: '60' },
  { label: '고기반찬', name: '닭가슴살', grams: '120' },
  { label: '채소/나물', name: '샐러드', grams: '100' },
  { label: '바나나/과일', name: '바나나', grams: '150' },
  { label: '고구마', name: '고구마', grams: '150' },
  { label: '요거트 1컵', name: '요거트', grams: '150' },
  { label: '견과류 한 줌', name: '견과류', grams: '25' },
  { label: '단백질 제품', name: '웨이 프로틴', grams: '50' },
  { label: '스타벅스 아메리카노', name: '스타벅스 카페 아메리카노', grams: '1' },
  { label: '스타벅스 카페라떼', name: '스타벅스 카페 라떼', grams: '1' },
  { label: '메가MGC 아메리카노', name: '메가MGC커피 아메리카노', grams: '1' },
  { label: '메가MGC 카페라떼', name: '메가MGC커피 카페라떼', grams: '1' },
  { label: '컴포즈 아메리카노', name: '컴포즈커피 아메리카노', grams: '1' },
  { label: '컴포즈 카페라떼', name: '컴포즈커피 카페라떼', grams: '1' },
  { label: '이디야 아메리카노', name: '이디야커피 아메리카노', grams: '1' },
  { label: '빽다방 아메리카노', name: '빽다방 아메리카노', grams: '1' },
  { label: '공차 밀크티', name: '공차 블랙 밀크티', grams: '1' },
  { label: '제로 탄산음료', name: '제로 탄산음료', grams: '355' },
  { label: '스프라이트/사이다', name: '탄산음료', grams: '355' },
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
  { keys: ['방울토마토', '토마토', 'cherry tomato', 'tomato'], name: '방울토마토', grams: '140', label: '단순 과일·채소' },
  { keys: ['바나나', 'banana'], name: '바나나', grams: '150', label: '과일류' },
  { keys: ['고구마', 'sweet potato'], name: '고구마', grams: '150', label: '탄수화물 식품' },
  { keys: ['계란', '달걀', 'egg'], name: '계란', grams: '60', label: '계란류' },
  { keys: ['요거트', '요구르트', 'yogurt', 'yoghurt'], name: '요거트', grams: '150', label: '유제품' },
  { keys: ['견과류', '아몬드', '호두', '캐슈넛', 'nuts', 'almond', 'walnut'], name: '견과류', grams: '25', label: '견과류' },
  { keys: ['두부', 'tofu'], name: '두부', grams: '120', label: '두부류' },
  { keys: ['우유', 'milk'], name: '우유', grams: '200', label: '유제품' },
  { keys: ['아메리카노', 'americano', 'blackcoffee', '블랙커피'], name: '아메리카노', grams: '355', label: '커피 음료' },
  { keys: ['카페라떼', '카페 라떼', '라떼', 'latte', 'cafelatte'], name: '카페라떼', grams: '355', label: '우유가 들어간 커피' },
  { keys: ['밀크티', 'milk tea', 'milktea', '버블티', '공차'], name: '밀크티', grams: '473', label: '차 음료' },
  { keys: ['스무디', 'smoothie', '프라페', 'frappe'], name: '스무디', grams: '450', label: '당류가 높은 음료' },
  { keys: ['에이드', 'ade', '주스', '쥬스', 'juice'], name: '과일음료', grams: '450', label: '과일·에이드 음료' },
  { keys: ['제로', 'zero', '제로콜라', '제로사이다'], name: '제로 탄산음료', grams: '355', label: '제로 음료' },
  { keys: ['콜라', '사이다', '스프라이트', 'sprite', '탄산음료', 'coke', 'cola', 'soda'], name: '탄산음료', grams: '355', label: '탄산음료' },
  { keys: ['프로틴', '웨이', 'protein', 'whey'], name: '웨이 프로틴', grams: '50', label: '단백질 제품' },
  { keys: ['나쵸', '나초', 'nacho', 'taco', '타코', '도도한나쵸'], name: '나쵸 스낵', grams: '92', label: '포장 스낵' },
  { keys: ['과자', '스낵', '칩', 'chip', 'snack'], name: '스낵 과자', grams: '80', label: '포장 스낵' },
];

const koreanFoodSearchCatalog = [
  { name: '흰쌀밥', aliases: ['쌀밥', '공기밥', '밥'], grams: '210', category: '한식 칼로리 DB', calories: 326, carb: 71.4, protein: 5.7, fat: 0.6, sodium: 4, sugar: 0.2, glycemicTag: '높음' },
  { name: '현미밥', aliases: ['잡곡밥'], grams: '210', category: '한식 칼로리 DB', calories: 347, carb: 73.5, protein: 7.4, fat: 2.5, sodium: 11, sugar: 1.1, glycemicTag: '보통' },
  { name: '배추김치', aliases: ['김치', '깍두기'], grams: '50', category: '한식 칼로리 DB', calories: 16, carb: 2.5, protein: 0.9, fat: 0.2, sodium: 320, sugar: 1, glycemicTag: '낮음' },
  { name: '된장찌개', aliases: ['김치찌개', '찌개', '국'], grams: '220', category: '한식 칼로리 DB', calories: 231, carb: 17.6, protein: 16.5, fat: 9.9, sodium: 1595, sugar: 4.4, glycemicTag: '낮음' },
  { name: '닭가슴살', aliases: ['닭 가슴살', 'chicken breast'], grams: '120', category: '단백질 DB', calories: 198, carb: 0, protein: 37.2, fat: 4.3, sodium: 89, sugar: 0, glycemicTag: '낮음' },
  { name: '계란', aliases: ['달걀', '삶은 계란'], grams: '60', category: '단백질 DB', calories: 86, carb: 0.4, protein: 7.6, fat: 5.7, sodium: 85, sugar: 0.2, glycemicTag: '낮음' },
  { name: '두부', aliases: ['tofu'], grams: '120', category: '단백질 DB', calories: 101, carb: 3, protein: 11.2, fat: 5, sodium: 8, sugar: 0.7, glycemicTag: '낮음' },
  { name: '고구마', aliases: ['sweet potato'], grams: '150', category: '탄수화물 DB', calories: 192, carb: 45, protein: 2.1, fat: 0.3, sodium: 54, sugar: 9.6, glycemicTag: '보통' },
  { name: '바나나', aliases: ['banana'], grams: '150', category: '과일 DB', calories: 134, carb: 34.5, protein: 1.7, fat: 0.5, sodium: 2, sugar: 18, glycemicTag: '보통' },
  { name: '샐러드', aliases: ['채소', 'salad'], grams: '160', category: '채소 DB', calories: 56, carb: 11.2, protein: 2.9, fat: 0.5, sodium: 56, sugar: 4, glycemicTag: '낮음' },
  { name: '스무디', aliases: ['프라페', 'smoothie', 'frappe'], grams: '450', category: '음료 DB', calories: 252, carb: 54, protein: 3.2, fat: 2.7, sodium: 108, sugar: 45, glycemicTag: '높음' },
  { name: '탄산음료', aliases: ['콜라', '사이다', '스프라이트', 'sprite', 'cola', 'soda'], grams: '355', category: '음료 DB', calories: 142, carb: 37.3, protein: 0, fat: 0, sodium: 21, sugar: 37.3, glycemicTag: '높음' },
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
  const cameraStartingRef = useRef(false);
  const [profile, setProfile] = useStoredProfile();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [savedReports, setSavedReports] = useState([]);
  const [captured, setCaptured] = useState(null);
  const [liveScan, setLiveScan] = useState({ status: 'idle', facts: {}, text: '' });
  const [saveState, setSaveState] = useState('');
  const [cameraZoom, setCameraZoom] = useState(1);

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

  async function startCamera(options = {}) {
    const localHostnames = ['localhost', '127.0.0.1'];
    const isLocalhost = localHostnames.includes(window.location.hostname);
    const userRequested = Boolean(options.userRequested);
    const hasLiveTrack = streamRef.current?.getVideoTracks?.().some((track) => track.readyState === 'live');

    if (hasLiveTrack) {
      if (videoRef.current && videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      setCameraReady(true);
      setCameraError('');
      return;
    }

    if (cameraStartingRef.current) return;

    if (!window.isSecureContext && !isLocalhost) {
      setCameraError('휴대폰 카메라는 HTTPS 주소에서만 켜집니다. Cloudflare Pages 주소로 열어주세요.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('이 브라우저에서는 카메라를 사용할 수 없습니다. Chrome에서 다시 열어주세요.');
      return;
    }

    const permissionState = await getCameraPermissionState();
    const previousPermission = localStorage.getItem(CAMERA_PERMISSION_KEY);
    const shouldAvoidAutoPrompt = permissionState === 'prompt' && previousPermission === 'asked' && !userRequested;
    if (shouldAvoidAutoPrompt) {
      setCameraError('카메라 권한 확인이 다시 필요합니다. 아래 버튼을 한 번 눌러 카메라를 다시 켜주세요.');
      return;
    }

    cameraStartingRef.current = true;
    localStorage.setItem(CAMERA_PERMISSION_KEY, 'asked');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      localStorage.setItem(CAMERA_PERMISSION_KEY, 'granted');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraReady(true);
        setCameraError('');
      }
    } catch {
      localStorage.setItem(CAMERA_PERMISSION_KEY, 'asked');
      setCameraError('카메라 권한이 필요합니다. 브라우저 주소창의 카메라 권한을 허용해주세요.');
    } finally {
      cameraStartingRef.current = false;
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    cameraStartingRef.current = false;
  }

  function capturePureCameraFrame() {
    const canvas = canvasRef.current;
    const video = videoRef.current || document.getElementById('camera-video');
    if (!canvas || !cameraReady || !video?.videoWidth || !video?.videoHeight) return '';

    drawZoomedVideoFrame(canvas, video, cameraZoom);
    return canvas.toDataURL('image/jpeg', CAPTURE_JPEG_QUALITY);
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
        setLiveScan((current) => mergeLiveFoodScan(current, food, detected.status));
        return;
      }

      const facts = parseNutritionText(detected.text);
      if (hasReadableNutritionFacts(facts)) {
        setLiveScan((current) => {
          const canHoldPrevious = current.food && (current.missCount || 0) < LIVE_SCAN_HOLD_FRAMES;
          const heldFood = food || (canHoldPrevious ? current.food : null);
          return {
            status: 'detected',
            facts: {
              ...current.facts,
              ...facts,
            },
            text: detected.text || current.text,
            food: heldFood,
            missCount: food ? 0 : heldFood ? (current.missCount || 0) + 1 : 0,
          };
        });
        return;
      }

      setLiveScan((current) => mergeLiveFoodScan(current, food, 'scanning', detected.text));
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

    drawZoomedVideoFrame(canvas, video, cameraZoom, LIVE_OCR_FRAME_MAX_WIDTH);
    return canvas;
  }

  function mergeLiveFoodScan(current, food, status = 'scanning', text = '') {
    if (food) {
      return {
        status: 'visual',
        facts: current.facts || {},
        text: text || current.text || '',
        food,
        missCount: 0,
      };
    }

    const canHoldPrevious = current.food && (current.missCount || 0) < LIVE_SCAN_HOLD_FRAMES;
    if (canHoldPrevious) {
      return {
        ...current,
        status: current.status === 'detected' ? 'detected' : 'visual',
        text: text || current.text || '',
        missCount: (current.missCount || 0) + 1,
      };
    }

    return {
      status: status === 'unsupported' ? 'unsupported' : 'scanning',
      facts: {},
      text: '',
      food: null,
      missCount: 0,
    };
  }

  async function handleShoot() {
    const photo = capturePureCameraFrame();
    if (!photo) return;

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

    const [detected, visionEstimate] = await Promise.all([readNutritionTextFromImage(photo), recognizeFoodWithVision(photo)]);
    const parsedFacts = detected.text ? parseNutritionText(detected.text) : {};
    const hasParsedFacts = hasReadableNutritionFacts(parsedFacts);
    const visualEstimate = visionEstimate || (await estimateFoodFromPhoto(photo, detected.text));
    setCaptured((current) => {
      if (!current) return current;
      const shouldApplyVisualEstimate = visualEstimate && (!current.foods.length || (current.foods.length === 1 && current.foods[0]?.estimated));
      const nextFoods = shouldApplyVisualEstimate ? [visualEstimate] : current.foods;

      return {
        ...current,
        foods: nextFoods,
        ocrStatus: hasParsedFacts ? 'detected' : detected.text ? 'text-detected' : hasReadableNutritionFacts(current.facts) ? 'detected' : detected.status,
        ocrText: detected.text || current.ocrText,
        facts: detected.text
          ? {
              ...current.facts,
              ...parsedFacts,
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
      startCamera({ userRequested: true });
    }
  }

  async function handleSave() {
    if (!report) return;
    if (isAnalysisUnavailable(report)) {
      setSaveState('분석 안됨');
      return;
    }
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

  function applyFoodCandidate(candidate) {
    setCaptured((current) => {
      if (!current) return current;
      const nextFood = {
        ...createEmptyFoodItem(),
        name: candidate.name,
        grams: candidate.grams || '100',
        estimated: false,
        visualReason: '',
        nutrients: candidate.nutrients || null,
        nutrientBasisGrams: candidate.grams || '100',
        brand: candidate.brand || '',
        category: candidate.category || '',
        serving: candidate.serving || '',
        sourceLabel: candidate.sourceLabel || '',
        sourceUrl: candidate.sourceUrl || '',
      };
      const shouldReplace = !current.foods.length || (current.foods.length === 1 && current.foods[0]?.estimated);
      return {
        ...current,
        foods: shouldReplace ? [nextFood] : [...current.foods, nextFood],
      };
    });
  }

  function applyNutritionFactsCandidate(candidate) {
    if (!candidate?.nutrients) return;
    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        ocrStatus: 'detected',
        foods: current.foods.filter((food) => !food.estimated),
        facts: {
          ...current.facts,
          foodName: candidate.name || current.facts.foodName,
          servingSize: candidate.serving || `${candidate.grams || 100}g`,
          calories: String(candidate.nutrients.calories ?? ''),
          carb: String(candidate.nutrients.carb ?? ''),
          sugar: String(candidate.nutrients.sugar ?? ''),
          protein: String(candidate.nutrients.protein ?? ''),
          fat: String(candidate.nutrients.fat ?? ''),
          saturatedFat: String(candidate.nutrients.saturatedFat ?? ''),
          transFat: String(candidate.nutrients.transFat ?? ''),
          sodium: String(candidate.nutrients.sodium ?? ''),
        },
      };
    });
  }

  async function uploadNutritionLabel(file) {
    if (!file) return { ok: false, message: '파일을 선택하지 않았습니다.' };

    const photo = await readFileAsDataUrl(file);
    setCaptured((current) => (current ? { ...current, ocrStatus: 'checking' } : current));

    const detected = await readNutritionTextFromImage(photo);
    const parsedFacts = detected.text ? parseNutritionText(detected.text) : {};
    const hasParsedFacts = hasReadableNutritionFacts(parsedFacts);

    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        ocrStatus: hasParsedFacts ? 'detected' : detected.text ? 'text-detected' : detected.status,
        ocrText: uniqueOcrLines([current.ocrText, detected.text]).join('\n'),
        facts: {
          ...current.facts,
          ...parsedFacts,
        },
      };
    });

    return {
      ok: hasParsedFacts,
      message: hasParsedFacts ? '성분표 숫자를 반영했습니다.' : '글자는 읽었지만 숫자 보정이 더 필요합니다.',
    };
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
            id="camera-video"
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover ${cameraReady ? 'block' : 'hidden'}`}
            style={{ transform: `scale(${cameraZoom})` }}
            autoPlay
            playsInline
            muted
          />
          <canvas ref={fallbackCanvasRef} width="900" height="1200" className={`absolute inset-0 h-full w-full object-cover ${cameraReady ? 'hidden' : 'block'}`} />
          <canvas ref={canvasRef} className="hidden" />

          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/5 to-black/80" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative h-[min(58vw,340px)] w-[min(58vw,340px)] rounded-full border-2 border-white/85 shadow-[0_0_0_18px_rgba(255,255,255,0.05)] md:h-[min(46vw,390px)] md:w-[min(46vw,390px)]">
              <div className="absolute left-[22%] right-[22%] top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-emerald-300/90 shadow-[0_0_24px_rgba(52,211,153,0.85)]" />
              {showCapturePrompt ? (
                <div className="absolute -bottom-14 left-1/2 w-max max-w-[82vw] -translate-x-1/2 rounded-full bg-black/45 px-4 py-2 text-center text-sm font-black text-white/90">
                  가까이 대고 가운데에 맞춰주세요
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
              <button
                type="button"
                onClick={() => startCamera({ userRequested: true })}
                className="mt-3 h-11 w-full rounded-full bg-amber-300 px-4 text-sm font-black text-amber-950"
              >
                카메라 다시 켜기
              </button>
            </div>
          ) : null}

          {cameraReady && !cameraError ? <LiveNutritionBadge liveScan={liveScan} /> : null}
          {cameraReady && !cameraError ? <LiveAnalysisPanel liveReport={liveReport} liveScan={liveScan} /> : null}
          {cameraReady && !cameraError ? <ZoomControl zoom={cameraZoom} onChange={setCameraZoom} /> : null}

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
          applyFoodCandidate={applyFoodCandidate}
          applyNutritionFactsCandidate={applyNutritionFactsCandidate}
          uploadNutritionLabel={uploadNutritionLabel}
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

function ReportView({
  captured,
  modeLabel,
  report,
  saveState,
  updateFood,
  addFood,
  removeFood,
  updateFacts,
  applyFoodCandidate,
  applyNutritionFactsCandidate,
  uploadNutritionLabel,
  onBack,
  onSave,
  onSpeak,
}) {
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
  const needsRecognitionHelp = shouldShowRecognitionHelp(captured, report);
  const analysisUnavailable = isAnalysisUnavailable(report);

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
          <button
            type="button"
            onClick={onSave}
            disabled={analysisUnavailable}
            className={`h-12 rounded-full px-5 font-black shadow-lg ${analysisUnavailable ? 'bg-slate-300 text-slate-500' : 'bg-slate-950 text-white'}`}
          >
            {analysisUnavailable ? '저장 불가' : saveState || '저장'}
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
            {analysisUnavailable ? '분석 안됨' : stampLabel}
          </div>
        </header>

        {needsRecognitionHelp ? <RecognitionIssueNotice /> : null}

        <section className="grid gap-5 md:grid-cols-[0.85fr_1.15fr]">
          <img src={captured.photo} alt="촬영된 음식" className="h-72 w-full rounded-lg border border-slate-200 object-cover md:h-full" />
          <div className="grid gap-4">
            <div className="rounded-lg border-2 border-slate-950 bg-white p-5">
              <h2 className="text-2xl font-black">음식 분석</h2>
              <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                사진만으로 음식명과 중량을 확정하지 않습니다. 음식명 검색 또는 빠른 보정으로 확인한 값만 계산에 반영합니다.
              </p>
              <FoodItemsForm foods={captured.foods} updateFood={updateFood} addFood={addFood} removeFood={removeFood} />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-xl font-black">식품 영양표 함께 분석</h2>
              <p className="mt-2 rounded-lg bg-slate-100 p-3 text-sm font-bold text-slate-600">
                {statusText(captured.ocrStatus)}
              </p>
              <NutritionLookupPanel
                captured={captured}
                onApplyFood={applyFoodCandidate}
                onApplyFacts={applyNutritionFactsCandidate}
                onUploadLabel={uploadNutritionLabel}
              />
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
  const analysisUnavailable = isAnalysisUnavailable(report);

  return (
    <section className="rounded-lg border-2 border-slate-950 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-teal-700">3단계 AI 메디-스포츠 영양 분석</p>
          <h2 className="mt-1 text-3xl font-black">A4 리포트 카드</h2>
        </div>
        <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white">
          {analysisUnavailable ? '분석 안됨' : traffic.badge}
        </span>
      </div>

      <div className="mt-5 grid gap-4">
        <ReportLine
          title="🍽️ 인식 음식 및 중량"
          body={analysisUnavailable ? '분석이 안됩니다' : report.items.length ? report.items.map(formatReportItemLabel).join(', ') : '촬영 음식 250g 기준 자동 추정'}
        />
        <ReportLine
          title="📊 칼로리 및 주요 영양소"
          body={
            analysisUnavailable
              ? '분석이 안됩니다'
              : `${formatMetric(report.totals.calories, 'kcal')} / 탄수화물 ${report.macroPercent.carb}%, 단백질 ${report.macroPercent.protein}%, 지방 ${report.macroPercent.fat}%`
          }
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ReportLine title="🏅 식단 점수" body={analysisUnavailable ? '분석이 안됩니다' : `${report.dietScore?.value ?? 0}점 · ${report.dietScore?.label || '보류'}`} />
          {analysisUnavailable ? <ReportLine title="🩸 혈당 관리" body="분석이 안됩니다" /> : <GlycemicReportCard glycemic={report.glycemic} />}
        </div>
        {report.items.some((item) => item.isPendingInfo) ? (
          <PendingInfoNotice items={report.items.filter((item) => item.isPendingInfo)} />
        ) : null}
        {report.sourceItems?.length ? <OfficialSourceList sources={report.sourceItems} /> : null}
        {report.additives?.length ? <AdditiveNotice additives={report.additives} /> : null}

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

function RecognitionIssueNotice() {
  return (
    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-red-950">
      <h2 className="text-xl font-black">분석이 안됩니다</h2>
      <p className="mt-1 text-sm font-bold leading-snug">
        현재 사진에서는 제품명이나 영양성분표 숫자를 충분히 읽지 못했습니다. 제품 포장은 앞면 제품명 또는 뒷면 영양성분표를 화면의 절반 이상으로 크게 촬영하거나,
        아래 검색/업로드에서 공식값을 적용하세요.
      </p>
    </div>
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

function GlycemicReportCard({ glycemic }) {
  const level = glycemic?.level || 'low';
  const styles = {
    low: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    medium: 'border-amber-200 bg-amber-50 text-amber-800',
    high: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div className={`rounded-lg border p-4 ${styles[level]}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-black">🩸 혈당 관리</h3>
        <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-black">{glycemic?.label || '낮음'}</span>
      </div>
      <p className="mt-2 text-sm font-black">
        탄수 {formatMetric(glycemic?.carbLoad, 'g')} · 당류 {formatMetric(glycemic?.sugar, 'g')}
      </p>
      {glycemic?.factors?.length ? <p className="mt-1 text-xs font-bold leading-snug">{glycemic.factors.join(' · ')}</p> : null}
      <p className="mt-2 text-sm font-bold leading-snug">{glycemic?.advice || '현재 입력값 기준 혈당 부담은 크지 않습니다.'}</p>
    </div>
  );
}

function formatReportItemLabel(item) {
  if (item.isPendingInfo) return `${item.name} (영양성분 확인 필요)`;
  if (item.serving) return `${item.name} (${item.serving})`;
  const portion = [
    item.quantity ? `약 ${item.quantity}${item.unitLabel || '개'}` : '',
    item.sizeLabel ? `${item.sizeLabel} 크기` : '',
    item.confidence ? `신뢰도 ${item.confidence}` : '',
    item.confidenceScore ? `자동 ${Math.round(Number(item.confidenceScore) * 100)}%` : '',
  ].filter(Boolean);
  const portionText = portion.length ? ` (${portion.join(' · ')})` : '';
  return `${item.name}${item.grams ? ` ${item.grams}g` : ''}${portionText}`;
}

function PendingInfoNotice({ items }) {
  const names = items.map((item) => item.name).join(', ');

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-amber-950">영양성분 확인 필요</h3>
          <p className="mt-1 text-sm font-bold leading-snug text-amber-900">
            {names}은 공식 DB에서 신뢰 가능한 값을 찾지 못해 열량, 탄수화물, 단백질, 지방, 나트륨을 0으로 처리했습니다.
            제품 성분표를 가까이 촬영하거나 음식명과 제공량을 보정하면 다시 계산됩니다.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-950">확인</span>
      </div>
    </div>
  );
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

function AdditiveNotice({ additives }) {
  const visibleAdditives = additives.slice(0, 5);
  const extraCount = additives.length - visibleAdditives.length;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-amber-950">🧪 첨가물 확인</h3>
          <p className="mt-1 text-sm font-bold leading-snug text-amber-900">
            성분표·원재료명에서 감지된 후보입니다. 유해 판정이 아니라 표시사항 확인용입니다.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-950">주의</span>
      </div>
      <div className="mt-3 grid gap-2">
        {visibleAdditives.map((item) => (
          <div key={`${item.category}-${item.term}`} className="rounded-lg border border-amber-100 bg-white p-3">
            <p className="text-sm font-black text-amber-950">
              {item.category} · {item.term}
            </p>
            <p className="mt-1 text-xs font-bold leading-snug text-amber-800">{item.caution}</p>
          </div>
        ))}
      </div>
      {extraCount > 0 ? <p className="mt-2 text-xs font-black text-amber-900">외 {extraCount}개 후보가 더 있습니다.</p> : null}
    </div>
  );
}

function sourceTypeLabel(source) {
  if (source.type === 'official-value') return '공식값 적용';
  if (source.type === 'safety-reference' && `${source.name} ${source.category}`.includes('첨가물')) return '식품첨가물 안전 확인';
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

function ZoomControl({ zoom, onChange }) {
  return (
    <div className="absolute bottom-[8.5rem] left-4 right-4 z-10 rounded-full border border-white/15 bg-black/45 px-4 py-3 shadow-2xl backdrop-blur md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-sm font-black text-white">배율</span>
        <input
          type="range"
          min="1"
          max="2.5"
          step="0.1"
          value={zoom}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 min-w-0 flex-1 accent-emerald-300"
          aria-label="카메라 배율 조정"
        />
        <span className="w-12 shrink-0 text-right text-sm font-black text-emerald-100">{Number(zoom).toFixed(1)}x</span>
      </div>
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
            <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-black text-amber-900">
                {food.visualReason ? `사진 후보: ${food.visualReason}` : '사진만으로는 확정하지 않습니다.'}
              </p>
              {food.quantity || food.sizeLabel || food.confidence ? (
                <div className="flex flex-wrap gap-2 text-xs font-black">
                  {food.quantity ? <span className="rounded-full bg-white px-3 py-1 text-emerald-800">수량 약 {food.quantity}{food.unitLabel || '개'}</span> : null}
                  {food.sizeLabel ? <span className="rounded-full bg-white px-3 py-1 text-emerald-800">크기 {food.sizeLabel}</span> : null}
                  {food.confidence ? <span className="rounded-full bg-white px-3 py-1 text-amber-700">신뢰도 {food.confidence}</span> : null}
                  {food.confidenceScore ? <span className="rounded-full bg-white px-3 py-1 text-slate-700">자동 신뢰 {Math.round(Number(food.confidenceScore) * 100)}%</span> : null}
                </div>
              ) : null}
              <QuickFoodPresetSelect foodId={food.id} onApply={updateFood} />
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
          {!food.estimated ? <QuickFoodPresetSelect foodId={food.id} onApply={updateFood} compact /> : null}
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

function QuickFoodPresetSelect({ foodId, onApply, compact = false }) {
  function handleChange(event) {
    const preset = foodCorrectionPresets[Number(event.target.value)];
    if (!preset) return;
    onApply(foodId, { name: preset.name, grams: preset.grams, estimated: false, visualReason: '', confidence: '', quantity: '', sizeLabel: '' });
    event.target.value = '';
  }

  return (
    <label className={`grid gap-1 text-sm font-black ${compact ? 'mt-1' : ''}`}>
      빠른 보정
      <select
        defaultValue=""
        onChange={handleChange}
        className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700"
      >
        <option value="">음식/제품 후보 선택</option>
        {foodCorrectionPresets.map((preset, index) => (
          <option key={`${preset.label}-${preset.name}`} value={index}>
            {preset.label}
          </option>
        ))}
      </select>
    </label>
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

function NutritionLookupPanel({ captured, onApplyFood, onApplyFacts, onUploadLabel }) {
  const initialQuery = captured.facts.foodName || captured.foods[0]?.name || '';
  const [query, setQuery] = useState(initialQuery);
  const [uploadStatus, setUploadStatus] = useState('');
  const [remoteStatus, setRemoteStatus] = useState('');
  const [remoteSearch, setRemoteSearch] = useState({ query: '', candidates: [] });
  const localCandidates = useMemo(() => createNutritionSearchCandidates(query), [query]);
  const remoteCandidates = remoteSearch.query === query.trim() ? remoteSearch.candidates : [];
  const candidates = useMemo(() => uniqueCandidates([...localCandidates, ...remoteCandidates]).slice(0, 10), [localCandidates, remoteCandidates]);
  const sourceLinks = useMemo(() => createOfficialSearchLinks(query, candidates), [query, candidates]);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus('성분표 읽는 중');
    const result = await onUploadLabel(file);
    setUploadStatus(result.message);
    event.target.value = '';
  }

  async function handleRemoteSearch() {
    const searchTerm = query.trim();
    if (!searchTerm) {
      setRemoteStatus('검색어를 입력하세요');
      return;
    }

    setRemoteStatus('공식 DB 검색 중');
    try {
      const response = await fetch(`/api/nutrition-search?q=${encodeURIComponent(searchTerm)}&limit=8`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        setRemoteSearch({ query: searchTerm, candidates: [] });
        setRemoteStatus(payload.message || '서버 검색을 사용할 수 없습니다');
        return;
      }

      const nextCandidates = (payload.candidates || []).map(normalizeRemoteCandidate).filter(Boolean);
      setRemoteSearch({ query: searchTerm, candidates: nextCandidates });
      setRemoteStatus(nextCandidates.length ? `공식 후보 ${nextCandidates.length}개` : '공식 후보 없음');
    } catch {
      setRemoteSearch({ query: searchTerm, candidates: [] });
      setRemoteStatus('서버 검색을 사용할 수 없습니다');
    }
  }

  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-2">
        <label className="grid gap-1 text-sm font-black">
          제품·외식 메뉴 검색
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-base"
            placeholder="예: 스타벅스 라떼, 빅맥, 현미밥"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRemoteSearch}
            className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-black text-white"
          >
            웹에서 찾기
          </button>
          <label className="grid h-10 cursor-pointer place-items-center rounded-lg bg-slate-950 px-4 text-sm font-black text-white">
            성분표 업로드
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
          {remoteStatus ? (
            <span className="grid min-h-10 place-items-center rounded-lg bg-white px-3 text-xs font-black text-slate-600">{remoteStatus}</span>
          ) : null}
          {uploadStatus ? (
            <span className="grid min-h-10 place-items-center rounded-lg bg-white px-3 text-xs font-black text-slate-600">{uploadStatus}</span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        {candidates.length ? (
          candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-950">{candidate.name}</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-500">
                    {candidate.category}
                    {candidate.serving ? ` · ${candidate.serving}` : candidate.grams ? ` · ${candidate.grams}g` : ''}
                  </p>
                  {candidate.meta?.standardDate || candidate.meta?.sourceFile ? (
                    <p className="mt-1 text-[11px] font-black text-teal-700">
                      {candidate.meta?.standardDate ? `DB 기준일 ${candidate.meta.standardDate}` : '공공 DB'}
                      {candidate.meta?.sourceFile ? ` · ${candidate.meta.sourceFile}` : ''}
                    </p>
                  ) : null}
                </div>
                {candidate.glycemicTag ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-800">혈당 {candidate.glycemicTag}</span>
                ) : null}
              </div>

              {candidate.nutrients ? (
                <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px] font-black text-slate-600">
                  <CandidateMetric label="kcal" value={candidate.nutrients.calories} />
                  <CandidateMetric label="탄수" value={candidate.nutrients.carb} />
                  <CandidateMetric label="단백" value={candidate.nutrients.protein} />
                  <CandidateMetric label="지방" value={candidate.nutrients.fat} />
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onApplyFood(candidate)}
                  className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white"
                >
                  음식 기록 적용
                </button>
                {candidate.nutrients ? (
                  <button
                    type="button"
                    onClick={() => onApplyFacts(candidate)}
                    className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700"
                  >
                    성분표 적용
                  </button>
                ) : null}
                {candidate.sourceUrl ? (
                  <a
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-9 place-items-center rounded-lg border border-teal-200 bg-teal-50 px-3 text-xs font-black text-teal-800"
                  >
                    공식 페이지
                  </a>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg bg-white p-3 text-sm font-black text-slate-500">일치 결과 없음</p>
        )}
      </div>

      {sourceLinks.length ? (
        <div className="flex flex-wrap gap-2">
          {sourceLinks.map((link) => (
            <a
              key={`${link.label}-${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-teal-200 bg-white px-3 py-2 text-xs font-black text-teal-800"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CandidateMetric({ label, value }) {
  return (
    <span className="rounded-md bg-slate-100 px-1.5 py-1">
      {label} {formatCompactNumber(value)}
    </span>
  );
}

function createNutritionSearchCandidates(query) {
  const normalized = normalizeLookupText(query);
  const productMatches = searchOfficialProductFoods(query, 5).map((entry) => toOfficialCandidate(entry, 'official-product'));
  const brandMatches = searchOfficialBrandFoodCandidates(query, 5).map((entry) => toOfficialCandidate(entry, 'official-menu'));
  const localMatches = searchLocalFoodCandidates(query, 8);
  const presetMatches = searchPresetFoodCandidates(query, 6);

  const candidates = normalized
    ? [...productMatches, ...brandMatches, ...localMatches, ...presetMatches]
    : koreanFoodSearchCatalog.slice(0, 6).map(toLocalFoodCandidate);

  return uniqueCandidates(candidates).slice(0, 8);
}

function searchOfficialBrandFoodCandidates(query, limit = 5) {
  const normalized = normalizeLookupText(query);
  if (!normalized) return [];

  return OFFICIAL_BRAND_FOODS.map((entry) => ({
    entry,
    score: scoreOfficialBrandFood(entry, normalized),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

function scoreOfficialBrandFood(entry, normalized) {
  const brand = normalizeLookupText(entry.brand);
  const terms = [entry.brand, ...(entry.keys || [])].map(normalizeLookupText).filter(Boolean);
  let score = 0;

  if (brand && normalized.includes(brand)) score += 8;
  terms.forEach((term) => {
    if (normalized.includes(term)) score += term.length >= 4 ? 8 : 4;
    if (term.includes(normalized)) score += normalized.length >= 3 ? 6 : 2;
  });

  return score;
}

function searchLocalFoodCandidates(query, limit = 8) {
  const normalized = normalizeLookupText(query);
  if (!normalized) return [];

  return koreanFoodSearchCatalog
    .map((item) => ({
      item,
      score: scoreSearchTerms([item.name, ...(item.aliases || []), item.category], normalized),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => toLocalFoodCandidate(item.item));
}

function searchPresetFoodCandidates(query, limit = 6) {
  const normalized = normalizeLookupText(query);
  if (!normalized) return [];

  const presetCandidates = foodCorrectionPresets.map((preset) => ({
    id: `preset-${preset.label}`,
    name: preset.name,
    grams: preset.grams,
    category: '빠른 기록 후보',
    sourceLabel: preset.label,
  }));
  const textCandidates = textFoodEstimates.map((item) => ({
    id: `estimate-${item.name}`,
    name: item.name,
    grams: item.grams,
    category: `${item.label} DB 후보`,
    sourceLabel: item.label,
  }));

  return [...presetCandidates, ...textCandidates]
    .map((candidate) => ({
      candidate,
      score: scoreSearchTerms([candidate.name, candidate.category, candidate.sourceLabel], normalized),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.candidate);
}

function toOfficialCandidate(entry, kind) {
  const name = createOfficialCandidateName(entry);
  return {
    id: `${kind}-${name}-${entry.sourceUrl || ''}`,
    kind,
    name,
    grams: '1',
    serving: entry.serving || '',
    brand: entry.brand || '',
    category: entry.category || (kind === 'official-product' ? '공식 제품 DB' : '외식 공식 메뉴'),
    sourceLabel: entry.sourceLabel || '공식 영양정보',
    sourceUrl: entry.sourceUrl || '',
    nutrients: extractCandidateNutrients(entry),
  };
}

function toLocalFoodCandidate(item) {
  return {
    id: `local-${item.name}`,
    kind: 'korean-food-db',
    name: item.name,
    grams: item.grams,
    category: item.category,
    sourceLabel: '한식 칼로리 DB',
    glycemicTag: item.glycemicTag,
    nutrients: extractCandidateNutrients(item),
  };
}

function normalizeRemoteCandidate(candidate) {
  if (!candidate?.name) return null;
  return {
    id: candidate.id || `server-${candidate.name}-${candidate.sourceUrl || ''}`,
    kind: candidate.kind || 'server-official-db',
    name: candidate.name,
    grams: candidate.grams || '1',
    serving: candidate.serving || '',
    brand: candidate.brand || '',
    category: candidate.category || '공식 메뉴 DB',
    sourceLabel: candidate.sourceLabel || '공식 영양정보',
    sourceUrl: candidate.sourceUrl || '',
    nutrients: extractCandidateNutrients(candidate.nutrients || {}),
    meta: candidate.meta || null,
  };
}

function createOfficialCandidateName(entry) {
  const primary = entry.keys?.[0] || entry.name || '공식 메뉴';
  const brand = entry.brand || '';
  const normalizedPrimary = normalizeLookupText(primary);
  const normalizedBrand = normalizeLookupText(brand);
  if (brand && normalizedBrand && !normalizedPrimary.includes(normalizedBrand)) return `${brand} ${primary}`;
  return primary;
}

function extractCandidateNutrients(source) {
  return {
    calories: numberOrEmpty(source.calories),
    carb: numberOrEmpty(source.carb),
    sugar: numberOrEmpty(source.sugar),
    protein: numberOrEmpty(source.protein),
    fat: numberOrEmpty(source.fat),
    saturatedFat: numberOrEmpty(source.saturatedFat),
    transFat: numberOrEmpty(source.transFat),
    sodium: numberOrEmpty(source.sodium),
    fiber: numberOrEmpty(source.fiber),
    leucine: numberOrEmpty(source.leucine),
    caffeine: numberOrEmpty(source.caffeine),
  };
}

function createOfficialSearchLinks(query, candidates = []) {
  const searchTerm = String(query || candidates[0]?.name || '').trim();
  const sourceLinks = [
    ...findOfficialProductSources(searchTerm),
    ...findOfficialNutritionSources(searchTerm),
    ...candidates
      .filter((candidate) => candidate.sourceUrl)
      .map((candidate) => ({
        brand: candidate.brand || candidate.name,
        category: candidate.category,
        url: candidate.sourceUrl,
      })),
  ].map((source) => ({
    label: source.brand ? `${source.brand} 공식` : '공식 페이지',
    url: source.url,
  }));

  const searchLinks = searchTerm
    ? [
        { label: '네이버 성분표', url: createSearchUrl('naver', `${searchTerm} 영양성분표`) },
        { label: '구글 칼로리', url: createSearchUrl('google', `${searchTerm} calories nutrition`) },
      ]
    : [];

  return uniqueLinks([...sourceLinks, ...searchLinks]).slice(0, 5);
}

function scoreSearchTerms(terms, normalized) {
  return terms
    .map(normalizeLookupText)
    .filter(Boolean)
    .reduce((score, term) => {
      if (normalized.includes(term)) return score + (term.length >= 4 ? 8 : 4);
      if (term.includes(normalized)) return score + (normalized.length >= 3 ? 6 : 2);
      return score;
    }, 0);
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${normalizeLookupText(candidate.name)}-${candidate.kind || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    if (!link.url || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function createSearchUrl(provider, query) {
  const encoded = encodeURIComponent(query);
  if (provider === 'naver') return `https://search.naver.com/search.naver?query=${encoded}`;
  return `https://www.google.com/search?q=${encoded}`;
}

function normalizeLookupText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^0-9a-z가-힣]/g, '');
}

function numberOrEmpty(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
}

function formatCompactNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '0';
  return Number.isInteger(parsed) ? String(parsed) : String(Math.round(parsed * 10) / 10);
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
            <li>2. 음식이나 식품 영양성분표를 둥근 테두리 가운데에 맞춥니다.</li>
            <li>3. 너무 멀면 배율 슬라이더를 올려 가까이 보이게 조정합니다.</li>
            <li>4. 가운데 안내가 깜빡이면 분석 준비 중입니다. 음식 후보가 잡히면 안내가 사라집니다.</li>
            <li>5. 위쪽의 실시간 자동 분석 카드에서 예상 열량, 당류, 나트륨을 먼저 확인합니다.</li>
            <li>6. 가운데 빨간 촬영 버튼을 누르면 A4 리포트 카드가 만들어집니다.</li>
            <li>7. 음식명이나 양이 다르면 결과 화면에서 수정한 뒤 저장합니다.</li>
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
  const hasTrustedItem = !isAnalysisUnavailable(report);

  if (!hasTrustedItem) green.push('분석이 안됩니다.');
  if (hasFood && hasTrustedItem) green.push('촬영 음식과 추정 중량을 기준으로 총열량과 탄·단·지 비율을 계산했습니다.');
  if (hasTrustedItem && report.totals.protein > 15) green.push('단백질 섭취가 포함되어 근육 유지와 회복에 도움이 됩니다.');
  if (hasTrustedItem && report.totals.sodium < 900) green.push('현재 추정 나트륨은 한 끼 기준에서 과도하지 않습니다.');
  if (!green.length) green.push('촬영값을 기준으로 식단 평가를 시작할 수 있습니다.');

  return {
    badge: report.stamp === 'red' ? '빨강 경고' : report.stamp === 'yellow' ? '노랑 주의' : '초록 적절',
    green: green.slice(0, 2).join(' '),
    yellow: report.risk.yellow.length ? report.risk.yellow.join(', ') : hasTrustedItem ? '현재 큰 주의 항목은 없습니다. 후보 음식이 다르면 버튼으로 보정하세요.' : '제품명 또는 성분표 확인이 필요합니다.',
    red: report.risk.red.length ? report.risk.red.join(', ') : '기저질환 관련 즉시 제한 경고는 감지되지 않았습니다.',
  };
}

function createCoachLine(report) {
  const medical = report.profile.medical || [];
  const has = (keyword) => medical.some((item) => String(item).includes(keyword));

  if (isAnalysisUnavailable(report)) {
    return '분석이 안됩니다. 제품명을 검색하거나 성분표 사진을 업로드하면 칼로리와 탄단지가 다시 계산됩니다.';
  }

  if (report.items.some((item) => item.isPendingInfo)) {
    return '신뢰 가능한 영양값을 찾지 못한 항목이 있습니다. 제품명 검색, 공식 페이지 확인, 성분표 업로드 중 하나로 먼저 보정하세요.';
  }

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

function shouldShowRecognitionHelp(captured, report) {
  const hasFacts = hasReadableNutritionFacts(captured?.facts);
  const hasFoodName = (captured?.foods || []).some((food) => String(food.name || '').trim());
  const hasTrustedItem = !isAnalysisUnavailable(report);
  return !hasTrustedItem && (!hasFacts || !hasFoodName);
}

function isAnalysisUnavailable(report) {
  return !report.items.some(hasTrustedReportItem);
}

function hasTrustedReportItem(item) {
  if (!item || item.isPendingInfo) return false;
  const values = ['calories', 'carb', 'protein', 'fat', 'sugar', 'sodium'].map((key) => Number(item[key] || 0));
  const positiveCount = values.filter((value) => Number.isFinite(value) && value > 0).length;
  if (item.official || item.matched) return positiveCount > 0;
  return positiveCount >= 2;
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

async function getCameraPermissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'camera' });
    return status.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function drawZoomedVideoFrame(canvas, video, zoom = 1, maxWidth = 0) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const safeZoom = Math.min(Math.max(Number(zoom) || 1, 1), 2.5);
  const cropWidth = Math.max(1, Math.floor(sourceWidth / safeZoom));
  const cropHeight = Math.max(1, Math.floor(sourceHeight / safeZoom));
  const sourceX = Math.floor((sourceWidth - cropWidth) / 2);
  const sourceY = Math.floor((sourceHeight - cropHeight) / 2);
  const scale = maxWidth ? Math.min(1, maxWidth / cropWidth) : 1;

  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
}

async function readNutritionTextFromImage(photo) {
  if (!photo) {
    return { status: 'manual', text: '' };
  }

  if (!('TextDetector' in window)) {
    return readTextWithTesseract(photo);
  }

  try {
    const image = await loadImage(photo);
    const detector = new window.TextDetector();
    const candidates = createOcrCandidateCanvases(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
    const text = await detectBestText(detector, candidates);
    if (text && hasReadableNutritionFacts(parseNutritionText(text))) {
      return { status: 'detected', text };
    }

    const precise = await readTextWithTesseract(photo, candidates);
    const mergedText = uniqueOcrLines([text, precise.text]).join('\n');
    return {
      status: hasReadableNutritionFacts(parseNutritionText(mergedText)) ? 'detected' : mergedText ? 'text-detected' : precise.status,
      text: mergedText,
    };
  } catch {
    return readTextWithTesseract(photo);
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

async function readTextWithTesseract(photo, candidates = []) {
  try {
    const { default: Tesseract } = await import('tesseract.js');
    const ocrTargets = candidates.length ? candidates.slice(0, 6).filter(Boolean) : [photo];
    const lines = [];

    for (const target of ocrTargets) {
      const result = await Tesseract.recognize(target, 'kor+eng', {
        logger: () => {},
        preserve_interword_spaces: '1',
      });
      if (result?.data?.text) lines.push(result.data.text);
      if (hasReadableNutritionFacts(parseNutritionText(lines.join('\n')))) break;
    }

    const text = uniqueOcrLines(lines).join('\n');
    return { status: text ? 'text-detected' : 'manual', text };
  } catch {
    return { status: 'unsupported', text: '' };
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

  const verticalLabelWidth = Math.floor(safeWidth * 0.62);
  const verticalLabelHeight = Math.floor(safeHeight * 0.86);
  const verticalLabelX = Math.floor((safeWidth - verticalLabelWidth) / 2);
  const verticalLabelY = Math.floor((safeHeight - verticalLabelHeight) / 2);
  const verticalLabel = drawCroppedCanvas(source, verticalLabelX, verticalLabelY, verticalLabelWidth, verticalLabelHeight, 1200, 1800);
  candidates.push(verticalLabel);
  candidates.push(createContrastCanvas(verticalLabel, { grayscale: true, contrast: 1.55, brightness: 16 }));

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

async function recognizeFoodWithVision(photo) {
  try {
    const image = await prepareVisionImage(photo);
    const response = await fetch('/api/vision-analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image }),
    });
    if (!response.ok) return null;

    const result = await response.json();
    const recognition = result?.foods?.[0];
    if (!recognition?.name || Number(recognition.confidence || 0) < 0.72) return null;

    const query = [recognition.brand, recognition.name].filter(Boolean).join(' ');
    let searchResponse = await fetch(`/api/nutrition-search?q=${encodeURIComponent(query)}&limit=8`);
    let searchResult = searchResponse.ok ? await searchResponse.json() : null;
    let candidates = Array.isArray(searchResult?.candidates) ? searchResult.candidates : [];
    if (!candidates.length && recognition.brand) {
      searchResponse = await fetch(`/api/nutrition-search?q=${encodeURIComponent(recognition.name)}&limit=8`);
      searchResult = searchResponse.ok ? await searchResponse.json() : null;
      candidates = Array.isArray(searchResult?.candidates) ? searchResult.candidates : [];
    }
    const normalizedName = normalizeLookupText(recognition.name);
    const candidate =
      candidates.find((item) => normalizeLookupText(item.name) === normalizedName) ||
      candidates.find((item) => normalizeLookupText(item.name).includes(normalizedName) || normalizedName.includes(normalizeLookupText(item.name))) ||
      candidates[0];

    const grams = String(Math.round(Number(recognition.estimatedGrams || candidate?.grams || 100)) || 100);
    return {
      ...createEmptyFoodItem(),
      name: candidate?.name || recognition.name,
      grams,
      estimated: !candidate?.nutrients,
      visualReason: `AI 비전 ${Math.round(Number(recognition.confidence) * 100)}%`,
      confidenceScore: Number(recognition.confidence),
      recognitionSource: result?.provider || 'ai-vision',
      nutrients: candidate?.nutrients || null,
      nutrientBasisGrams: candidate?.grams || grams,
      brand: candidate?.brand || recognition.brand || '',
      category: candidate?.category || '',
      serving: candidate?.serving || '',
      sourceLabel: candidate?.sourceLabel || '',
      sourceUrl: candidate?.sourceUrl || '',
    };
  } catch (error) {
    console.warn('Vision recognition unavailable', error);
    return null;
  }
}

async function prepareVisionImage(photo) {
  const image = await loadImage(photo);
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
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
  const textEstimate = createFoodEstimateFromText(text);
  const visualEstimate = createBestVisualFoodEstimate(source, sourceWidth, sourceHeight, text);

  if (textEstimate && visualEstimate && textEstimate.name !== visualEstimate.name) {
    return keepTrustedCameraEstimate({
      ...textEstimate,
      visualReason: `${textEstimate.visualReason} / 화면 형태 후보: ${visualEstimate.name}`,
      confidenceScore: Math.max(Number(textEstimate.confidenceScore || 0) - 0.04, MIN_TEXT_CAMERA_ESTIMATE_SCORE),
    });
  }

  return keepTrustedCameraEstimate(textEstimate || visualEstimate);
}

function keepTrustedCameraEstimate(estimate) {
  if (!estimate) return null;
  const score = Number(estimate.confidenceScore || 0);
  const source = estimate.recognitionSource || '';
  const minimum = source.includes('text') || source.includes('official') ? MIN_TEXT_CAMERA_ESTIMATE_SCORE : MIN_TRUSTED_CAMERA_ESTIMATE_SCORE;
  if (score >= minimum) return estimate;
  return null;
}

function createBestVisualFoodEstimate(source, sourceWidth, sourceHeight, text = '') {
  const candidates = createFoodCropCandidates(sourceWidth, sourceHeight);
  const estimates = candidates
    .map((candidate) => {
      const stats = createFoodColorStatsFromCrop(source, sourceWidth, sourceHeight, candidate);
      const estimate = createFoodEstimateFromColor(stats, text);
      if (!estimate) return null;

      return {
        estimate: {
          ...estimate,
          visualReason: `${estimate.visualReason} (${candidate.label} 영역)`,
        },
        score: scoreVisualEstimate(stats, estimate, candidate),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return estimates[0]?.estimate || null;
}

function createFoodCropCandidates(sourceWidth, sourceHeight) {
  const minSide = Math.min(sourceWidth, sourceHeight);
  const shortFrame = minSide < 600;
  return [
    { ratio: FOOD_FOCUS_CROP_RATIO, xBias: 0, yBias: 0, label: '중앙' },
    { ratio: shortFrame ? 0.82 : 0.74, xBias: 0, yBias: 0, label: '넓은 중앙' },
    { ratio: 0.52, xBias: -0.22, yBias: 0, label: '왼쪽' },
    { ratio: 0.52, xBias: 0.22, yBias: 0, label: '오른쪽' },
    { ratio: 0.52, xBias: 0, yBias: -0.2, label: '위쪽' },
    { ratio: 0.52, xBias: 0, yBias: 0.2, label: '아래쪽' },
  ];
}

function createFoodColorStatsFromCrop(source, sourceWidth, sourceHeight, candidate) {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cropSize = Math.floor(Math.min(sourceWidth, sourceHeight) * candidate.ratio);
  const centerX = sourceWidth / 2 + cropSize * candidate.xBias;
  const centerY = sourceHeight / 2 + cropSize * candidate.yBias;
  const sourceX = clampNumber(Math.floor(centerX - cropSize / 2), 0, Math.max(0, sourceWidth - cropSize));
  const sourceY = clampNumber(Math.floor(centerY - cropSize / 2), 0, Math.max(0, sourceHeight - cropSize));

  ctx.drawImage(source, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

  const pixels = ctx.getImageData(0, 0, size, size).data;
  return createFoodColorStats(pixels);
}

function scoreVisualEstimate(stats, estimate, candidate) {
  const centerBonus = candidate.xBias === 0 && candidate.yBias === 0 ? 6 : 0;
  const textBonus = estimate.confidence === '높음' ? 20 : estimate.confidence === '보통' ? 10 : 0;
  const name = estimate.name;

  if (['아메리카노', '카페라떼', '밀크티', '스무디', '과일음료', '탄산음료', '제로 탄산음료'].includes(name)) {
    return (stats.liquid || 0) * 210 + (stats.spread?.liquid || 0) * 90 + centerBonus + textBonus + 14;
  }
  if (name === '방울토마토') {
    return (stats.red + stats.orange) * 180 + (stats.components?.warm?.totalCells || 0) * 2 + centerBonus + textBonus;
  }
  if (name === '계란') {
    return stats.white * 145 + stats.yellow * 80 + (stats.components?.white?.totalCells || 0) * 1.6 + centerBonus + textBonus;
  }
  if (name === '고구마') {
    return (stats.orange + stats.brown) * 150 + (stats.components?.orange?.largest || 0) * 2 + centerBonus + textBonus;
  }
  if (name === '견과류') {
    return stats.brown * 160 + (stats.components?.brown?.count || 0) * 4 + centerBonus + textBonus;
  }
  if (name === '샐러드') return stats.green * 120 + centerBonus + textBonus;
  if (name === '바나나') return stats.yellow * 120 + centerBonus + textBonus;
  if (name === '흰쌀밥') return stats.white * 100 + centerBonus + textBonus;
  if (name === '닭가슴살') return stats.brown * 110 + centerBonus + textBonus;
  return centerBonus + textBonus;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createFoodColorStats(pixels) {
  const stats = { green: 0, yellow: 0, white: 0, brown: 0, red: 0, orange: 0, black: 0, cream: 0, total: 0 };
  const gridSize = 8;
  const cellSets = {
    green: new Set(),
    yellow: new Set(),
    white: new Set(),
    brown: new Set(),
    red: new Set(),
    orange: new Set(),
    black: new Set(),
    cream: new Set(),
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

    if (brightness < 25 || brightness > 245) continue;
    stats.total += 1;

    if (r > 130 && r > g * 1.22 && r > b * 1.22 && saturation > 0.24) {
      stats.red += 1;
      cellSets.red.add(cell);
    }
    if (r > 135 && g > 65 && g < r * 0.92 && b < 120 && saturation > 0.22) {
      stats.orange += 1;
      cellSets.orange.add(cell);
    }
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
    if (brightness >= 45 && brightness < 100 && saturation < 0.5) {
      stats.black += 1;
      cellSets.black.add(cell);
    }
    if (brightness > 125 && brightness <= 220 && r >= g * 0.9 && g >= b * 0.82 && saturation >= 0.08 && saturation < 0.35) {
      stats.cream += 1;
      cellSets.cream.add(cell);
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
    red: stats.red / total,
    orange: stats.orange / total,
    black: stats.black / total,
    cream: stats.cream / total,
    liquid: (stats.black + stats.brown + stats.cream + stats.yellow + stats.orange + stats.red) / total,
    spread: {
      green: cellSets.green.size / 64,
      yellow: cellSets.yellow.size / 64,
      white: cellSets.white.size / 64,
      brown: cellSets.brown.size / 64,
      red: cellSets.red.size / 64,
      orange: cellSets.orange.size / 64,
      black: cellSets.black.size / 64,
      cream: cellSets.cream.size / 64,
      liquid: mergeCellSets(cellSets.black, cellSets.brown, cellSets.cream, cellSets.yellow, cellSets.orange, cellSets.red).size / 64,
      warm: mergeCellSets(cellSets.red, cellSets.orange, cellSets.yellow).size / 64,
    },
    components: {
      green: createGridComponents(cellSets.green),
      yellow: createGridComponents(cellSets.yellow),
      white: createGridComponents(cellSets.white),
      brown: createGridComponents(cellSets.brown),
      red: createGridComponents(cellSets.red),
      orange: createGridComponents(cellSets.orange),
      black: createGridComponents(cellSets.black),
      cream: createGridComponents(cellSets.cream),
      liquid: createGridComponents(mergeCellSets(cellSets.black, cellSets.brown, cellSets.cream, cellSets.yellow, cellSets.orange, cellSets.red)),
      warm: createGridComponents(mergeCellSets(cellSets.red, cellSets.orange, cellSets.yellow)),
    },
  };
}

function mergeCellSets(...sets) {
  const merged = new Set();
  sets.forEach((set) => set.forEach((cell) => merged.add(cell)));
  return merged;
}

function createGridComponents(cellSet) {
  const cells = new Set(cellSet);
  const components = [];
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  cells.forEach((start) => {
    if (!cells.has(start)) return;
    const stack = [start];
    cells.delete(start);
    let size = 0;

    while (stack.length) {
      const current = stack.pop();
      size += 1;
      const [x, y] = current.split('-').map(Number);
      directions.forEach(([dx, dy]) => {
        const next = `${x + dx}-${y + dy}`;
        if (cells.has(next)) {
          cells.delete(next);
          stack.push(next);
        }
      });
    }

    components.push(size);
  });

  const largest = Math.max(0, ...components);
  return {
    count: components.length,
    largest,
    average: components.length ? components.reduce((sum, value) => sum + value, 0) / components.length : 0,
    totalCells: components.reduce((sum, value) => sum + value, 0),
  };
}

function createFoodEstimateFromText(text) {
  const normalized = normalizeRecognitionText(text);
  if (!normalized) return null;

  const officialFood = findOfficialProductFood(text) || findOfficialBrandFood(text);
  if (officialFood) {
    const officialKey = officialFood.keys[0];
    const officialName = normalizeRecognitionText(officialKey).includes(normalizeRecognitionText(officialFood.brand))
      ? officialKey
      : `${officialFood.brand} ${officialKey}`;
    return createVisualEstimatedFood(
      officialName,
      '1',
      `${officialFood.brand} 공식 제품명/브랜드 글자를 인식했어요`,
      { recognitionSource: 'official-text', confidenceScore: 0.94 },
    );
  }

  const hint = textFoodEstimates.find((entry) => entry.keys.some((key) => normalized.includes(normalizeRecognitionText(key))));
  if (!hint) return null;

  const textPortion = createTextPortionEstimate(hint, text);
  if (textPortion) return textPortion;

  const sourceBrand = findOfficialProductSources(text)[0]?.brand || findOfficialNutritionSources(text)[0]?.brand || '';
  const sourceAwareName = sourceBrand && !normalizeRecognitionText(hint.name).includes(normalizeRecognitionText(sourceBrand))
    ? `${sourceBrand} ${hint.name}`
    : hint.name;

  return createVisualEstimatedFood(sourceAwareName, hint.grams, `글자에서 ${sourceBrand ? `${sourceBrand} ` : ''}${hint.label} 단서를 인식했어요`, {
    recognitionSource: sourceBrand ? 'official-text' : 'ocr-text',
    confidenceScore: sourceBrand ? 0.88 : 0.82,
  });
}

function createTextPortionEstimate(hint, text = '') {
  const portionMap = {
    방울토마토: { unitGram: 18, unitLabel: '개', max: 40 },
    계란: { unitGram: 50, unitLabel: '개', max: 10 },
    고구마: { unitGram: 140, unitLabel: '개', max: 8 },
    바나나: { unitGram: 120, unitLabel: '개', max: 8 },
    요거트: { unitGram: 150, unitLabel: '컵', max: 5 },
    견과류: { unitGram: 25, unitLabel: '줌', max: 5 },
  };
  const portion = portionMap[hint.name];
  if (!portion) return null;

  const quantity = extractQuantityNearFoodText(text, hint.keys, portion.max);
  if (!quantity) return null;

  return createPortionEstimatedFood(
    hint.name,
    String(quantity * portion.unitGram),
    `글자에서 ${hint.label}와 수량 ${quantity}${portion.unitLabel} 단서를 인식했어요`,
    { quantity, unitLabel: portion.unitLabel, sizeLabel: '보통', confidence: '높음', recognitionSource: 'ocr-text', confidenceScore: 0.9 },
  );
}

function extractQuantityNearFoodText(text = '', keys = [], max = 20) {
  const source = String(text || '').replace(/\s+/g, ' ');
  for (const key of keys) {
    const escapedKey = escapeRegExp(key);
    const patterns = [
      new RegExp(`${escapedKey}\\s*(\\d{1,2})(?!\\d)\\s*(개|알|컵|줌|봉|팩)`, 'i'),
      new RegExp(`(\\d{1,2})(?!\\d)\\s*(개|알|컵|줌|봉|팩)\\s*${escapedKey}`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      const value = Number(match?.[1]);
      if (Number.isFinite(value) && value >= 1 && value <= max) return value;
    }
  }
  return 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createFoodEstimateFromColor(stats, text = '') {
  if (stats.total < 450) return null;
  const hasKnownFoodText = hasKnownFoodTextSignal(text);
  const beverageEstimate = createBeverageEstimateFromShape(stats, text);
  if (beverageEstimate) return beverageEstimate;
  if (!hasKnownFoodText) return null;

  const simplePortion = createSimplePortionEstimate(stats, text);
  if (simplePortion) return simplePortion;

  if (isPackagedSnackShape(stats, text)) {
    return createVisualEstimatedFood('스낵 과자', '80', '포장 스낵처럼 보이는 색상·로고·봉지 형태 후보가 보여요', {
      recognitionSource: 'visual-shape',
      confidenceScore: 0.72,
    });
  }
  if (isCompactFoodShape(stats, 'green', hasKnownFoodText) && stats.green > 0.24) {
    return createVisualEstimatedFood('샐러드', '180', '초록색 채소와 둥근 음식 형태가 함께 보여요', {
      recognitionSource: 'visual-shape',
      confidenceScore: 0.74,
    });
  }
  if (isCompactFoodShape(stats, 'yellow', hasKnownFoodText) && stats.yellow > 0.25) {
    return createVisualEstimatedFood('바나나', '150', '노란색 음식 형태가 화면 일부에 모여 보여요', {
      recognitionSource: 'visual-shape',
      confidenceScore: 0.73,
    });
  }
  if (isCompactFoodShape(stats, 'white', hasKnownFoodText) && stats.white > 0.34) {
    return createVisualEstimatedFood('흰쌀밥', '150', '밝은 흰색 음식 형태가 화면 일부에 모여 보여요', {
      recognitionSource: 'visual-shape',
      confidenceScore: 0.71,
    });
  }
  if (isCompactFoodShape(stats, 'brown', hasKnownFoodText) && stats.brown > 0.28) {
    return createVisualEstimatedFood('닭가슴살', '140', '갈색 단백질 반찬 형태가 화면 일부에 모여 보여요', {
      recognitionSource: 'visual-shape',
      confidenceScore: 0.71,
    });
  }
  return null;
}

function createBeverageEstimateFromShape(stats, text = '') {
  const normalized = normalizeRecognitionText(text);
  const drinkText = hasDrinkTextSignal(text);
  const cupLike = hasCupLikeShape(stats);
  const solidFoodLike =
    (stats.components?.green?.largest || 0) >= 18 ||
    (stats.components?.warm?.largest || 0) >= 22 ||
    (stats.components?.white?.largest || 0) >= 30;
  const darkLiquid = stats.black + stats.brown * 0.8;
  const milkLiquid = stats.cream + stats.white * 0.35;
  const coloredLiquid = stats.red + stats.orange + stats.yellow * 0.7;
  const liquidSpread = stats.spread?.liquid || 0;
  const liquidCells = stats.components?.liquid?.totalCells || 0;

  if (!drinkText && (!cupLike || solidFoodLike || liquidSpread < 0.12 || liquidCells < 6)) return null;

  if (normalized.includes('제로') || normalized.includes('zero')) {
    return createPortionEstimatedFood(
      '제로 탄산음료',
      '355',
      '제품명 글자에서 제로 음료 단서를 인식했어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: '보통', recognitionSource: 'ocr-text', confidenceScore: 0.88 },
    );
  }

  if (normalized.includes('밀크티') || normalized.includes('milktea') || normalized.includes('공차') || normalized.includes('버블티')) {
    return createPortionEstimatedFood(
      '밀크티',
      '473',
      '브랜드/제품명 글자와 컵 안의 밝은 음료 색을 함께 인식했어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '높음' : '보통', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.86 : 0.58 },
    );
  }

  if (normalized.includes('라떼') || normalized.includes('latte')) {
    return createPortionEstimatedFood(
      '카페라떼',
      '355',
      '컵과 내용물을 분리해 우유가 들어간 커피 후보로 봤어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '높음' : '보통', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.86 : 0.58 },
    );
  }

  if (normalized.includes('스무디') || normalized.includes('smoothie') || normalized.includes('프라페') || normalized.includes('frappe')) {
    return createPortionEstimatedFood(
      '스무디',
      '450',
      '제품명 글자와 컵 안 색을 함께 보고 당류가 높은 음료 후보로 봤어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '높음' : '보통', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.86 : 0.58 },
    );
  }

  if (normalized.includes('에이드') || normalized.includes('ade') || normalized.includes('주스') || normalized.includes('쥬스') || normalized.includes('juice')) {
    return createPortionEstimatedFood(
      '과일음료',
      '450',
      '제품명 글자와 컵 안 색을 함께 보고 과일·에이드 음료 후보로 봤어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '높음' : '보통', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.86 : 0.58 },
    );
  }

  if (normalized.includes('콜라') || normalized.includes('사이다') || normalized.includes('스프라이트') || normalized.includes('sprite') || normalized.includes('cola') || normalized.includes('coke') || normalized.includes('soda')) {
    return createPortionEstimatedFood(
      '탄산음료',
      '355',
      '제품명 글자에서 탄산음료 단서를 인식했어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '높음' : '보통', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.9 : 0.58 },
    );
  }

  if (normalized.includes('아메리카노') || normalized.includes('americano') || normalized.includes('블랙커피') || darkLiquid >= 0.12) {
    return createPortionEstimatedFood(
      '아메리카노',
      '355',
      '컵은 제외하고 어두운 커피색 내용물만 음료 후보로 분리했어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '높음' : '보통', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.82 : 0.58 },
    );
  }

  if (milkLiquid >= 0.16 && (drinkText || cupLike)) {
    return createPortionEstimatedFood(
      '카페라떼',
      '355',
      '컵은 제외하고 밝은 우유색 내용물만 음료 후보로 분리했어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '보통' : '낮음', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.78 : 0.52 },
    );
  }

  if (coloredLiquid >= 0.12 && (drinkText || cupLike)) {
    return createPortionEstimatedFood(
      '과일음료',
      '450',
      '컵은 제외하고 색이 있는 액체 내용물만 음료 후보로 분리했어요',
      { unitLabel: '잔', sizeLabel: '보통', confidence: drinkText ? '보통' : '낮음', recognitionSource: drinkText ? 'ocr-text' : 'visual-drink', confidenceScore: drinkText ? 0.78 : 0.52 },
    );
  }

  return null;
}

function createSimplePortionEstimate(stats, text = '') {
  if (hasPackagedFoodTextSignal(text) || hasCookedDishTextSignal(text) || hasDrinkTextSignal(text) || hasCupLikeShape(stats)) return null;

  const warmRatio = stats.red + stats.orange + stats.yellow * 0.35;
  const warmComponents = stats.components?.warm || {};
  if (
    warmRatio >= 0.045 &&
    stats.red + stats.orange >= 0.035 &&
    warmComponents.totalCells >= 3 &&
    (warmComponents.count >= 2 || warmRatio <= 0.2) &&
    (stats.spread?.warm || 0) <= 0.5
  ) {
    const count = estimateItemCount(warmComponents, warmRatio, 0.045, 1, 14);
    const size = estimateSizeLabel(warmRatio / Math.max(count, 1), [0.028, 0.062]);
    const grams = estimatePortionGrams(count, 18, size);
    return createPortionEstimatedFood(
      '방울토마토',
      grams,
      `붉은색 둥근 덩어리 ${count}개 후보를 감지했어요`,
      {
        quantity: count,
        sizeLabel: size.label,
        confidence: confidenceLabel(count >= 2 ? 0.76 : 0.62),
        recognitionSource: 'visual-portion',
        confidenceScore: count >= 2 ? 0.76 : 0.62,
      },
    );
  }

  const whiteYellowRatio = stats.white + stats.yellow * 0.7;
  const whiteComponents = stats.components?.white || {};
  if (stats.white >= 0.16 && stats.yellow >= 0.01 && whiteComponents.totalCells >= 4 && (stats.green + stats.brown) < 0.25) {
    const count = estimateItemCount(whiteComponents, whiteYellowRatio, 0.16, 1, 4);
    const size = estimateSizeLabel(whiteYellowRatio / Math.max(count, 1), [0.11, 0.22]);
    const grams = estimatePortionGrams(count, 50, size);
    return createPortionEstimatedFood(
      '계란',
      grams,
      `흰색과 노른자색 형태로 계란 ${count}개 후보를 감지했어요`,
      { quantity: count, sizeLabel: size.label, confidence: confidenceLabel(0.68), recognitionSource: 'visual-portion', confidenceScore: 0.68 },
    );
  }

  const orangeBrownRatio = stats.orange + stats.brown * 0.75;
  const orangeBrownComponents = createMergedComponentStats(stats.components?.orange, stats.components?.brown);
  const orangeBrownSpread = (stats.spread?.orange || 0) + (stats.spread?.brown || 0);
  if (orangeBrownRatio >= 0.1 && orangeBrownComponents.count <= 4 && orangeBrownSpread <= 0.42 && stats.green < 0.14 && stats.red < 0.09) {
    const count = estimateItemCount(orangeBrownComponents, orangeBrownRatio, 0.22, 1, 3);
    const size = estimateSizeLabel(orangeBrownRatio / Math.max(count, 1), [0.14, 0.28]);
    const grams = estimatePortionGrams(count, 140, size);
    return createPortionEstimatedFood(
      '고구마',
      grams,
      `갈색·주황색 긴 음식 형태로 고구마 ${count}개 후보를 감지했어요`,
      { quantity: count, sizeLabel: size.label, confidence: confidenceLabel(0.64), recognitionSource: 'visual-portion', confidenceScore: 0.64 },
    );
  }

  const brownComponents = stats.components?.brown || {};
  if (stats.brown >= 0.06 && brownComponents.count >= 3 && brownComponents.largest <= 14 && (stats.spread?.brown || 0) <= 0.42 && stats.green < 0.2 && stats.white < 0.4) {
    const handfuls = Math.max(1, Math.min(2, Math.round(stats.brown / 0.16)));
    const grams = handfuls * 25;
    return createPortionEstimatedFood(
      '견과류',
      grams,
      `작은 갈색 조각이 여러 개 보여 견과류 ${handfuls}줌 후보로 계산했어요`,
      {
        quantity: handfuls,
        unitLabel: '줌',
        sizeLabel: handfuls > 1 ? '많음' : '보통',
        confidence: confidenceLabel(0.6),
        recognitionSource: 'visual-portion',
        confidenceScore: 0.6,
      },
    );
  }

  return null;
}

function createMergedComponentStats(...componentStats) {
  const stats = componentStats.filter(Boolean);
  return {
    count: stats.reduce((sum, item) => sum + Number(item.count || 0), 0),
    largest: Math.max(0, ...stats.map((item) => Number(item.largest || 0))),
    average: stats.length ? stats.reduce((sum, item) => sum + Number(item.average || 0), 0) / stats.length : 0,
    totalCells: stats.reduce((sum, item) => sum + Number(item.totalCells || 0), 0),
  };
}

function estimateItemCount(components, ratio, ratioPerItem, min, max) {
  const byArea = Math.round(ratio / ratioPerItem);
  const byComponent = Math.max(components.count || 0, components.largest >= 9 ? Math.round((components.totalCells || 0) / 7) : 0);
  return Math.min(max, Math.max(min, byArea, byComponent || 1));
}

function estimateSizeLabel(areaPerItem, thresholds) {
  if (areaPerItem < thresholds[0]) return { label: '작음', multiplier: 0.8 };
  if (areaPerItem > thresholds[1]) return { label: '큼', multiplier: 1.2 };
  return { label: '보통', multiplier: 1 };
}

function estimatePortionGrams(count, unitGram, size) {
  return String(Math.max(1, Math.round(count * unitGram * size.multiplier)));
}

function confidenceLabel(score) {
  if (score >= 0.75) return '높음';
  if (score >= 0.58) return '보통';
  return '낮음';
}

function isPackagedSnackShape(stats, text = '') {
  if (!hasPackagedFoodTextSignal(text) || hasCookedDishTextSignal(text)) return false;
  const colorMix = stats.green + stats.yellow + stats.white;
  const spreadMix = (stats.spread?.green || 0) + (stats.spread?.yellow || 0) + (stats.spread?.white || 0);
  const yellowMinimum = 0.04;
  const greenMinimum = 0.02;
  return stats.yellow >= yellowMinimum && stats.green >= greenMinimum && colorMix >= 0.24 && spreadMix >= 0.16;
}

function hasPackagedFoodTextSignal(text) {
  const normalized = normalizeRecognitionText(text);
  if (!normalized) return false;
  const packagedTerms = [
    '영양정보',
    '영양성분',
    '총내용량',
    '나트륨',
    '탄수화물',
    '당류',
    '단백질',
    '포화지방',
    '트랜스지방',
    'kcal',
    '나쵸',
    '나초',
    'nacho',
    'chip',
    'snack',
    'orion',
  ];
  return packagedTerms.some((term) => normalized.includes(normalizeRecognitionText(term)));
}

function hasDrinkTextSignal(text) {
  const normalized = normalizeRecognitionText(text);
  if (!normalized) return false;
  const drinkTerms = [
    '커피',
    '카페',
    '아메리카노',
    '라떼',
    '밀크티',
    '버블티',
    '스무디',
    '프라페',
    '에이드',
    '주스',
    '쥬스',
    '음료',
    '콜라',
    '사이다',
    '스프라이트',
    '제로',
    'coffee',
    'americano',
    'latte',
    'milktea',
    'smoothie',
    'frappe',
    'juice',
    'ade',
    'cola',
    'coke',
    'soda',
    'sprite',
    'starbucks',
    '스타벅스',
    '메가mgc',
    '메가커피',
    '컴포즈',
    '이디야',
    '빽다방',
    '공차',
    '투썸',
    '커피빈',
    '더벤티',
    '매머드',
    '카페051',
    '텐퍼센트',
    '하삼동',
    '달콤커피',
    '쥬씨',
  ];
  return drinkTerms.some((term) => normalized.includes(normalizeRecognitionText(term)));
}

function hasKnownFoodTextSignal(text) {
  const normalized = normalizeRecognitionText(text);
  if (!normalized) return false;
  return textFoodEstimates.some((entry) => entry.keys.some((key) => normalized.includes(normalizeRecognitionText(key))));
}

function hasCupLikeShape(stats) {
  const broadRim = stats.white >= 0.08 && (stats.spread?.white || 0) >= 0.1;
  const visibleLiquid = stats.liquid >= 0.11 && (stats.spread?.liquid || 0) >= 0.12;
  const limitedVegetableFood = stats.green < 0.18 && (stats.components?.green?.largest || 0) < 18;
  const limitedWarmSolidFood = stats.red + stats.orange < 0.24 && (stats.components?.warm?.largest || 0) < 24;
  const notRiceDominant = !(stats.white > 0.42 && (stats.components?.white?.largest || 0) >= 30 && stats.black < 0.04 && stats.brown < 0.04);
  return broadRim && visibleLiquid && limitedVegetableFood && limitedWarmSolidFood && notRiceDominant;
}

function hasCookedDishTextSignal(text) {
  const normalized = normalizeRecognitionText(text);
  if (!normalized) return false;
  const cookedTerms = [
    '찌개',
    '된장국',
    '된장',
    '시래기국',
    '시래기',
    '국물',
    '국밥',
    '감자탕',
    '설렁탕',
    '갈비탕',
    '반찬',
    '밥',
    'bowl',
    'soup',
    'stew',
  ];
  return cookedTerms.some((term) => normalized.includes(normalizeRecognitionText(term)));
}

function isCompactFoodShape(stats, key, hasTextSignal) {
  const spread = stats.spread?.[key] || 0;
  const maxSpread = hasTextSignal ? 0.72 : 0.46;
  return spread >= 0.06 && spread <= maxSpread;
}

function createVisualEstimatedFood(name, grams, visualReason, metadata = {}) {
  return {
    ...createEstimatedFoodItem(),
    name,
    grams,
    visualReason,
    recognitionSource: metadata.recognitionSource || 'visual-shape',
    confidenceScore: metadata.confidenceScore || 0,
  };
}

function createPortionEstimatedFood(name, grams, visualReason, metadata = {}) {
  return {
    ...createVisualEstimatedFood(name, grams, visualReason),
    quantity: metadata.quantity || '',
    unitLabel: metadata.unitLabel || '개',
    sizeLabel: metadata.sizeLabel || '',
    confidence: metadata.confidence || '',
    recognitionSource: metadata.recognitionSource || 'visual-portion',
    confidenceScore: metadata.confidenceScore || 0,
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
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
  if (status === 'checking') return '정밀 분석 중입니다. 시간이 조금 걸려도 제품명과 성분표 숫자를 끝까지 확인합니다.';
  if (status === 'detected') return '성분표에서 읽은 값이 일부 입력되었습니다. 음식 분석과 함께 합산됩니다.';
  if (status === 'text-detected') return '제품명 또는 원재료명은 읽었지만, 성분표 숫자는 확인이 필요합니다. 숫자를 크게 다시 촬영하거나 아래 칸을 보정하세요.';
  if (status === 'unsupported') return '이 브라우저의 기본 OCR이 제한되어 보조 OCR을 시도했습니다. 숫자가 비어 있으면 성분표를 더 크게 다시 촬영하세요.';
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
  const coreKeys = ['calories', 'carb', 'protein', 'fat', 'sugar', 'sodium'];
  return coreKeys.filter((key) => hasFactValue(facts, key)).length >= 2;
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
