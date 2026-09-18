import { sameFoodName, updateFoodDetails } from './services/foodPortions';
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
import { recordRecognitionCorrection, recordRecognitionObservation } from './services/recognitionLearningStore';
import { assessMeasurementConfidence, TRUST_TIER_LABEL } from './services/measurementConfidence';
import { detectBarcodeFromCanvas } from './services/barcodeScanner';
import { getVoiceUnitDefaultGrams, parseVoiceMealFoods } from './services/voiceMealParser';
import { MealSteps, MealPhoto, MacroBar, DailyBudget, FoodNutritionCard, EatingOrder, foodColors, PortionPicker, FoodEvidence } from './components/MealPresentation';
import { normalizeFoodPosition, scaleHistoryItem } from './services/mealPresentation';
import { DiaryCalendar, DailyJournal, SixNutrientGuide, PeriodReview, readJournal, diaryStats, dateKey } from './components/DiaryCalendar';
import PhotoBatch from './components/PhotoBatch';
import NutritionUpdates from './components/NutritionUpdates';
import { readPhotoTiming } from './services/photoTiming';
import { localDateTime, mealTypeAt } from './services/diaryInsights';

const PROFILE_KEY = 'nutritionCameraProfile.v2';
const CAMERA_PERMISSION_KEY = 'nutritionCameraPermission.v1';
const LIVE_NUTRIENT_SCAN_INTERVAL_MS = 900;
const LIVE_OCR_EVERY_FRAMES = 2;
const FOOD_FOCUS_CROP_RATIO = 0.58;
const LIVE_SCAN_HOLD_FRAMES = 5;
const LIVE_SCAN_SWITCH_FRAMES = 2;
const LIVE_SCAN_SMOOTHING_WEIGHT = 0.38;
const CAPTURE_JPEG_QUALITY = 0.94;
const CAMERA_BURST_FRAME_COUNT = 3;
const MIN_AUTO_CONFIRM_VISION_SCORE = 0.85;
const NUTRITION_SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NUTRITION_SEARCH_STORAGE_KEY = 'nutritionSearchCache.v2';
const FAST_OCR_TIMEOUT_MS = 1800;
const PRECISION_OCR_TIMEOUT_MS = 5000;
const CAPTURE_VISION_TIMEOUT_MS = 8000;
const NETWORK_SEARCH_TIMEOUT_MS = 8000;
const AI_QUOTA_WARNING_MESSAGE = '무료 AI 한도를 초과했습니다. AI 인식이 일시 제한될 수 있으며, DB 직접 검색과 수동 선택은 계속 사용할 수 있습니다.';

const nutritionSearchCache = new Map();
let aiQuotaWarningShown = false;
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
  { keys: ['김치', '배추김치'], name: '배추김치', grams: '50', label: '김치류' },
  { keys: ['된장찌개'], name: '된장찌개', grams: '220', label: '국/찌개류' },
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
  { name: '제육볶음', aliases: ['돼지고기 제육볶음', '고추장 제육볶음'], grams: '200', category: '외식 1인분 추정 DB', sourceLabel: '식품의약품안전처 유사제품 100g 값으로 1접시 환산', calories: 370, carb: 23.6, protein: 27.6, fat: 18.4, sodium: 1046, sugar: 7, glycemicTag: '낮음' },
  { name: '김치볶음밥', aliases: ['김치 볶음밥'], grams: '300', category: '외식 1인분 추정 DB', sourceLabel: '식품의약품안전처 유사제품 100g 값으로 1그릇 환산', calories: 552, carb: 80.19, protein: 14.19, fat: 19.2, sodium: 1164, sugar: 4.2, glycemicTag: '높음' },
  { name: '맥심 T.O.P 마스터 라떼', aliases: ['맥심 티오피 마스터 라떼', 'TOP 마스터라떼', 'Maxim T.O.P Master Latte', '마스터 라떼'], grams: '275', brand: '동서식품', category: '제품 표시 영양정보', sourceLabel: '제품 전면 표시 275ml', calories: 117, caffeine: 99, glycemicTag: '높음' },
  { name: '마파두부', aliases: ['마파 두부', 'Mapo tofu'], grams: '300', category: '외식 1인분 추정 DB', sourceLabel: '식품의약품안전처 유사제품 100g 값으로 1인분 환산', calories: 327, carb: 16.08, protein: 21.87, fat: 19.44, sodium: 1056, sugar: 7.35, glycemicTag: '낮음' },
  { name: '동아제약 얼박사', aliases: ['얼박사', '아이스 백 사이더 에너지 드링크', 'Ice Bac Cider', 'ICE BACK CIDER', '박카스 사이다'], grams: '355', brand: '동아제약', category: '공식 제품 DB', sourceLabel: '동아제약 공식 제품정보', sourceUrl: 'https://www.dapharm.com/en/brand/product/BCS01', official: true, calories: 145, caffeine: 100, glycemicTag: '높음' },
  { name: '옥수수', aliases: ['구운 옥수수', '스위트콘', '콘'], grams: '100', category: '일반 식품 평균 DB', sourceLabel: '일반 식품 100g 평균값', calories: 96, carb: 21, protein: 3.4, fat: 1.5, sodium: 1, sugar: 4.5, glycemicTag: '보통' },
  { name: '버터', aliases: ['가염버터', '무염버터'], grams: '10', category: '일반 식품 평균 DB', sourceLabel: '버터 10g 평균값', calories: 72, carb: 0, protein: 0.1, fat: 8.1, sodium: 64, sugar: 0, glycemicTag: '낮음' },
  { name: '흰쌀밥', aliases: ['쌀밥', '공기밥', '밥'], grams: '210', category: '한식 칼로리 DB', calories: 326, carb: 71.4, protein: 5.7, fat: 0.6, sodium: 4, sugar: 0.2, glycemicTag: '높음' },
  { name: '현미밥', aliases: ['잡곡밥'], grams: '210', category: '한식 칼로리 DB', calories: 347, carb: 73.5, protein: 7.4, fat: 2.5, sodium: 11, sugar: 1.1, glycemicTag: '보통' },
  { name: '배추김치', aliases: ['김치'], grams: '50', category: '한식 칼로리 DB', calories: 16, carb: 2.5, protein: 0.9, fat: 0.2, sodium: 320, sugar: 1, glycemicTag: '낮음' },
  { name: '된장찌개', aliases: [], grams: '220', category: '한식 칼로리 DB', calories: 231, carb: 17.6, protein: 16.5, fat: 9.9, sodium: 1595, sugar: 4.4, glycemicTag: '낮음' },
  { name: '감자탕', aliases: ['뼈다귀', '뼈다귀해장국', '뼈해장국'], grams: '900', category: '외식 1인분 추정 DB', sourceLabel: '외식 음식 평균 추정값', calories: 429, carb: 27.1, protein: 33.4, fat: 20.2, sodium: 2027, sugar: 4.2, glycemicTag: '보통' },
  { name: '돼지국밥', aliases: ['돼지 국밥'], grams: '800', category: '외식 1인분 추정 DB', sourceLabel: '외식 음식 평균 추정값', calories: 467, carb: 66, protein: 29, fat: 10, sodium: 1720, sugar: 2.4, glycemicTag: '높음' },
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
  const liveScanFrameRef = useRef(0);
  const barcodeLookupRef = useRef('');
  const cameraStartingRef = useRef(false);
  const analysisRunRef = useRef(0);
  const [profile, setProfile] = useStoredProfile();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(() => window.location.hash === '#diary');
  const [diaryDay, setDiaryDay] = useState(dateKey());
  const [savedReports, setSavedReports] = useState([]);
  const [batchFiles, setBatchFiles] = useState(null);
  const [photoQueue, setPhotoQueue] = useState([]);
  const [queueError, setQueueError] = useState('');
  useEffect(() => { void loadSavedReports(); }, []);
  const [captured, setCaptured] = useState(null);
  const [liveScan, setLiveScan] = useState({ status: 'idle', facts: {}, text: '' });
  const [barcodeMatch, setBarcodeMatch] = useState({ status: 'idle', code: '', candidate: null });
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

  const confidence = useMemo(
    () => (report ? assessMeasurementConfidence(report, captured?.liveEstimateSnapshot ?? null) : null),
    [report, captured],
  );

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
    if (!cameraReady || captured || settingsOpen || diaryOpen || batchFiles || cameraError) {
      stopLiveNutrientScan();
      return undefined;
    }

    startLiveNutrientScan();
    return () => stopLiveNutrientScan();
  }, [cameraReady, captured, settingsOpen, diaryOpen, batchFiles, cameraError]);

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

    drawVideoFrame(canvas, video);
    return canvas.toDataURL('image/jpeg', CAPTURE_JPEG_QUALITY);
  }

  async function captureBestCameraFrame() {
    const frames = [];
    for (let index = 0; index < CAMERA_BURST_FRAME_COUNT; index += 1) {
      const photo = capturePureCameraFrame();
      if (photo) frames.push(photo);
      if (index < CAMERA_BURST_FRAME_COUNT - 1) await waitForCameraFrame();
    }
    if (frames.length < 2) return frames[0] || '';

    const scores = await Promise.all(frames.map(scoreCapturedPhotoQuality));
    const bestIndex = scores.reduce((best, score, index) => (score > scores[best] ? index : best), 0);
    return frames[bestIndex];
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
    liveScanFrameRef.current = 0;

    setLiveScan((current) => ({ ...current, status: current.status === 'detected' ? 'detected' : 'scanning' }));
    runLiveNutrientScan();
    liveScanTimerRef.current = window.setInterval(runLiveNutrientScan, LIVE_NUTRIENT_SCAN_INTERVAL_MS);
  }

  async function runLiveNutrientScan() {
    if (liveScanBusyRef.current || !cameraReady || captured || settingsOpen || document.visibilityState === 'hidden') return;

    const canvas = drawLiveFrameForText();
    if (!canvas) return;

    liveScanBusyRef.current = true;
    try {
      liveScanFrameRef.current += 1;
      const shouldReadText = liveScanFrameRef.current === 1 || liveScanFrameRef.current % LIVE_OCR_EVERY_FRAMES === 0;
      if (shouldReadText) checkBarcodeFromCanvas(canvas);
      const detected = shouldReadText
        ? await readNutritionTextFromCanvas(canvas, textDetectorRef)
        : { status: 'visual', text: '' };
      const food = estimateFoodFromCanvas(canvas, detected.text);
      if (!detected.text) {
        setLiveScan((current) => mergeLiveFoodScan(current, food, detected.status));
        return;
      }

      const facts = parseNutritionText(detected.text);
      if (hasReadableNutritionFacts(facts)) {
        setLiveScan((current) => {
          const merged = mergeLiveFoodScan(current, food, 'detected', detected.text);
          return {
            ...merged,
            status: 'detected',
            facts: {
              ...current.facts,
              ...facts,
            },
            text: detected.text || current.text,
          };
        });
        return;
      }

      setLiveScan((current) => mergeLiveFoodScan(current, food, 'scanning', detected.text));
    } catch {
      setLiveScan((current) => mergeLiveFoodScan(current, null, 'scanning'));
    } finally {
      liveScanBusyRef.current = false;
    }
  }

  async function checkBarcodeFromCanvas(canvas) {
    try {
      const code = await detectBarcodeFromCanvas(canvas);
      if (!code || code === barcodeLookupRef.current) return;
      barcodeLookupRef.current = code;
      setBarcodeMatch({ status: 'looking-up', code, candidate: null });

      const response = await fetch(`/api/barcode-lookup?code=${encodeURIComponent(code)}`);
      const payload = await response.json().catch(() => ({}));
      if (barcodeLookupRef.current !== code) return;
      setBarcodeMatch(response.ok && payload.ok && payload.candidate
        ? { status: 'found', code, candidate: payload.candidate }
        : { status: 'not-found', code, candidate: null });
    } catch {
      // 다음 스캔 프레임에서 다시 시도합니다.
    }
  }

  function drawLiveFrameForText() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video?.videoWidth || !video?.videoHeight) return null;

    drawVideoFrame(canvas, video, LIVE_OCR_FRAME_MAX_WIDTH);
    return canvas;
  }

  function mergeLiveFoodScan(current, food, status = 'scanning', text = '') {
    if (food) {
      const currentKey = normalizeRecognitionText(current.food?.name || '');
      const nextKey = normalizeRecognitionText(food.name || '');
      const isSameFood = Boolean(current.food && currentKey && currentKey === nextKey);

      if (current.food && !isSameFood) {
        const candidateFrames = current.candidateName === nextKey ? (current.candidateFrames || 0) + 1 : 1;
        if (candidateFrames < LIVE_SCAN_SWITCH_FRAMES) {
          return {
            ...current,
            status: current.status === 'detected' ? 'detected' : 'visual',
            text: text || current.text || '',
            missCount: 0,
            candidateName: nextKey,
            candidateFrames,
          };
        }
      }

      const sampleCount = isSameFood ? Math.min((current.sampleCount || 1) + 1, 12) : 1;
      const stabilizedFood = isSameFood ? smoothLiveFoodEstimate(current.food, food) : food;
      return {
        status: status === 'detected' ? 'detected' : 'visual',
        facts: current.facts || {},
        text: text || current.text || '',
        food: stabilizedFood,
        missCount: 0,
        sampleCount,
        candidateName: '',
        candidateFrames: 0,
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
      sampleCount: 0,
      candidateName: '',
      candidateFrames: 0,
    };
  }

  function smoothLiveFoodEstimate(previous, next) {
    const previousGrams = Number(previous?.grams || 0);
    const nextGrams = Number(next?.grams || 0);
    const previousConfidence = Number(previous?.confidenceScore || 0);
    const nextConfidence = Number(next?.confidenceScore || 0);
    const grams = previousGrams > 0 && nextGrams > 0
      ? Math.round(previousGrams * (1 - LIVE_SCAN_SMOOTHING_WEIGHT) + nextGrams * LIVE_SCAN_SMOOTHING_WEIGHT)
      : nextGrams || previousGrams;
    const confidenceScore = previousConfidence > 0 && nextConfidence > 0
      ? previousConfidence * (1 - LIVE_SCAN_SMOOTHING_WEIGHT) + nextConfidence * LIVE_SCAN_SMOOTHING_WEIGHT
      : nextConfidence || previousConfidence;

    return {
      ...previous,
      ...next,
      grams,
      confidenceScore: Number(confidenceScore.toFixed(3)),
    };
  }

  async function handlePhotoUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.length > 20 || files.some((file) => file.size > 30 * 1024 * 1024)) {
      setCameraError('한 번에 최대 20장, 사진당 30 MB까지 선택해 주세요.');
      return;
    }
    if (files.length > 1) { setBatchFiles(files); setDiaryOpen(false); return; }
    try {
      const file = files[0];
      const timing = await readPhotoTiming(file);
      const photo = await readFileAsDataUrl(file);
      setDiaryOpen(false);
      await handleShoot(await prepareVisionImage(photo), timing);
    } catch {
      setCameraError('사진을 열지 못했어요. 다른 사진을 골라주세요.');
    }
  }

  async function startQueuedPhoto(row) {
    const photo = await prepareVisionImage(await readFileAsDataUrl(row.file));
    setQueueError('');
    setDiaryOpen(false);
    setBatchFiles(null);
    await handleShoot(photo, row);
  }

  async function startPhotoBatch(rows) {
    // Keep the complete queue if reading or analysing a photo fails.
    setPhotoQueue(rows);
    await startQueuedPhoto(rows[0]);
  }

  async function handleShoot(uploadedPhoto, timing = {}) {
    const fromUpload = typeof uploadedPhoto === 'string';
    const scan = fromUpload ? { facts: {}, text: '', food: null } : liveScan;
    const photo = fromUpload ? uploadedPhoto : await captureBestCameraFrame();
    if (!photo) return;
    const analysisRun = ++analysisRunRef.current;

    const liveEstimateSnapshot = !fromUpload && liveReport ? createLiveCalorieEstimate(liveReport, scan) : null;
    const barcodeFood = !fromUpload && barcodeMatch.status === 'found' && barcodeMatch.candidate
      ? candidateToFoodItem(barcodeMatch.candidate)
      : null;
    const initialFacts = {
      ...createEmptyNutritionFacts(),
      ...scan.facts,
    };
    setCaptured({
      photo,
      eatenAt: timing.dateTime || localDateTime(),
      mealType: timing.mealType || mealTypeAt(new Date()),
      timeSource: timing.timeSource || 'capture',
      timeConfirmed: timing.timeConfirmed ?? true,
      foods: barcodeFood ? [barcodeFood] : scan.food ? [scan.food] : [],
      facts: initialFacts,
      analysisStatus: 'analyzing',
      ocrStatus: hasReadableNutritionFacts(scan.facts) ? 'detected' : 'checking',
      ocrText: scan.text || '',
      liveEstimateSnapshot,
    });
    setSaveState('');

    const canSkipVision = Boolean(barcodeFood) || isTrustedLocalRecognition(scan.food, scan.facts);
    const [fastDetected, visionFoods] = await Promise.all([
      resolveWithin(readNutritionTextFastFromImage(photo), FAST_OCR_TIMEOUT_MS, { status: 'manual', text: '' }),
      canSkipVision ? Promise.resolve([]) : resolveWithin(recognizeFoodsWithVision(photo), CAPTURE_VISION_TIMEOUT_MS, []),
    ]);
    if (analysisRun !== analysisRunRef.current) return;
    let detected = fastDetected;
    const fastFacts = detected.text ? parseNutritionText(detected.text) : {};
    const needsPrecisionOcr = !visionFoods.length && !barcodeFood && !scan.food && !hasReadableNutritionFacts(fastFacts);
    if (needsPrecisionOcr) {
      detected = await resolveWithin(readNutritionTextFromImage(photo), PRECISION_OCR_TIMEOUT_MS, detected);
      if (analysisRun !== analysisRunRef.current) return;
    }
    const parsedFacts = detected.text ? parseNutritionText(detected.text) : {};
    const hasParsedFacts = hasReadableNutritionFacts(parsedFacts);
    const fallbackEstimate = visionFoods.length || barcodeFood ? null : await estimateFoodFromPhoto(photo, detected.text);
    const visualEstimates = visionFoods.length ? visionFoods : fallbackEstimate ? [fallbackEstimate] : [];
    const manualReviewFood = !barcodeFood && !visualEstimates.length && !scan.food
      ? {
          ...createEmptyFoodItem(),
          name: '촬영 음식 직접 검색',
          grams: '100',
          estimated: true,
          requiresConfirmation: true,
          visualReason: '자동 인식 결과가 없어 영양 DB에서 직접 확인해야 합니다.',
          recognitionSource: 'manual-review',
        }
      : null;
    const reviewFoods = barcodeFood ? [barcodeFood] : visualEstimates.length ? visualEstimates : scan.food ? [scan.food] : [manualReviewFood];
    recordRecognitionObservation(visualEstimates);
    setCaptured((current) => {
      if (!current) return current;
      const shouldApplyVisualEstimate = visualEstimates.length && (!current.foods.length || (current.foods.length === 1 && current.foods[0]?.estimated));
      const nextFoods = shouldApplyVisualEstimate
        ? visualEstimates
        : !current.foods.length && manualReviewFood
          ? [manualReviewFood]
          : current.foods;
      const hasAnalysisResult = nextFoods.some((food) => String(food?.name || '').trim()) || hasParsedFacts || hasReadableNutritionFacts(current.facts);

      return {
        ...current,
        foods: nextFoods,
        analysisStatus: hasAnalysisResult ? 'searching-references' : 'failed',
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

    const canOpenResultDirectly = reviewFoods.length > 0 && reviewFoods.every(
      (food) => food?.nutrients && !food.estimated && !food.requiresConfirmation,
    );
    if (canOpenResultDirectly) {
      setCaptured((current) => current ? { ...current, analysisStatus: 'complete' } : current);
      return;
    }

    if (reviewFoods.length) {
      const referenceGroups = await createFoodReferenceGroups(reviewFoods);
      if (analysisRun !== analysisRunRef.current) return;
      setCaptured((current) => {
        if (!current) return current;
        return {
          ...current,
          referenceGroups,
          analysisStatus: referenceGroups.length ? 'review' : 'complete',
        };
      });
    }
  }

  async function handleAnalyzeFoodRegion({ xRatio, yRatio }) {
    if (!captured?.photo) return { status: 'error' };
    const analysisRun = analysisRunRef.current;
    try {
      const crop = await cropPhotoAroundPoint(captured.photo, xRatio, yRatio);
      const detectedFoods = (await recognizeFoodsWithVision(crop.photo)).map((food) => ({ ...food, position: food.position ? { x: crop.x + food.position.x * crop.width, y: crop.y + food.position.y * crop.height } : { x: xRatio, y: yRatio } }));
      if (analysisRun !== analysisRunRef.current) return { status: 'cancelled' };
      const regionFoods = detectedFoods.length
        ? detectedFoods
        : [{
            ...createEmptyFoodItem(),
            id: `region-manual-${Date.now()}`,
            name: '추가 음식 직접 검색',
            grams: '70',
            estimated: true,
            requiresConfirmation: true,
            visualReason: '선택 영역에서 자동 후보를 찾지 못했습니다. 음식명을 직접 검색해주세요.',
            recognitionSource: 'region-manual-review',
            position: { x: xRatio, y: yRatio },
          }];
      const newGroups = await createFoodReferenceGroups(regionFoods);
      if (analysisRun !== analysisRunRef.current) return { status: 'cancelled' };
      const existingGroups = Array.isArray(captured.referenceGroups) ? captured.referenceGroups : [];
      const existingKeys = new Set(existingGroups.map((group) => normalizeLookupText(group.detectedFood?.name)));
      const uniqueGroups = newGroups.filter((group) => {
        const name = normalizeLookupText(group.detectedFood?.name);
        if (name.includes('직접검색')) return true;
        if (!name || existingKeys.has(name)) return false;
        existingKeys.add(name);
        return true;
      });
      const addedCount = uniqueGroups.length;
      setCaptured((current) => {
        if (!current) return current;
        return {
          ...current,
          foods: [...(current.foods || []), ...uniqueGroups.map((group) => group.detectedFood)],
          referenceGroups: [...(current.referenceGroups || []), ...uniqueGroups],
          analysisStatus: 'review',
        };
      });
      return { status: detectedFoods.length ? (addedCount ? 'found' : 'duplicate') : 'manual', addedCount };
    } catch (error) {
      console.warn('Food region analysis failed', error);
      return { status: 'error' };
    }
  }

  function handleRetake() {
    setPhotoQueue([]);
    setQueueError('');
    analysisRunRef.current += 1;
    setCaptured(null);
    setSaveState('');
    setLiveScan({ status: 'scanning', facts: {}, text: '', food: null });
    setBarcodeMatch({ status: 'idle', code: '', candidate: null });
    barcodeLookupRef.current = '';

    const hasLiveTrack = streamRef.current?.getVideoTracks?.().some((track) => track.readyState === 'live');
    if (!hasLiveTrack) {
      setCameraReady(false);
      startCamera({ userRequested: true });
    }
  }

  function switchToManualFoodSearch() {
    analysisRunRef.current += 1;
    const manualFood = {
      ...createEmptyFoodItem(),
      id: `manual-search-${Date.now()}`,
      name: '촬영 음식 직접 검색',
      grams: '100',
      estimated: true,
      requiresConfirmation: true,
      visualReason: '자동 분석을 기다리지 않고 음식명을 직접 검색합니다.',
      recognitionSource: 'manual-review',
    };
    setCaptured((current) => current ? {
      ...current,
      foods: [manualFood],
      referenceGroups: [{
        id: `reference-${manualFood.id}`,
        detectedFood: manualFood,
        candidates: [],
        images: [],
      }],
      analysisStatus: 'review',
      ocrStatus: 'manual',
    } : current);
  }

  async function handleVoiceMealInput(transcript) {
    const parsedVoiceFoods = parseVoiceMealFoods(transcript);
    const createVoiceFood = ({ name, grams, portionAmount, portionUnit }, candidate) => {
      if (candidate) {
        const candidateFood = candidateToFoodItem(candidate);
        const candidateGrams = Number(candidateFood.grams || 100);
        const useTypicalPortion = portionAmount
          && ['그릇', '접시', '인분'].includes(portionUnit)
          && String(candidate.kind || '').includes('public')
          && candidateGrams <= 100;
        const appliedGrams = grams || (portionAmount
          ? String(Math.round((useTypicalPortion ? getVoiceUnitDefaultGrams(portionUnit) : candidateGrams) * portionAmount))
          : candidateFood.grams);
        return {
          ...candidateFood,
          grams: appliedGrams,
          quantity: portionAmount ? String(portionAmount) : candidateFood.quantity,
          unitLabel: portionUnit || candidateFood.unitLabel,
          recognitionSource: 'voice-input',
        };
      }
      const fallbackGrams = grams || (portionAmount ? String(Math.round(getVoiceUnitDefaultGrams(portionUnit) * portionAmount)) : '100');
      return {
        ...createEmptyFoodItem(),
        name,
        grams: fallbackGrams,
        quantity: portionAmount ? String(portionAmount) : '',
        unitLabel: portionUnit || '',
        recognitionSource: 'voice-input',
      };
    };

    const localCandidates = parsedVoiceFoods.map(({ name }) => createNutritionSearchCandidates(name)[0] || null);
    const immediateFoods = parsedVoiceFoods.map((food, index) => createVoiceFood(
      food,
      localCandidates[index]?.nutrients ? localCandidates[index] : null,
    ));

    if (!immediateFoods.length) return;
    stopLiveNutrientScan();
    setSaveState('');
    setCaptured({
      photo: '',
      foods: immediateFoods,
      facts: createEmptyNutritionFacts(),
      ocrStatus: 'voice-input',
      ocrText: transcript,
      analysisStatus: 'complete',
      inputMethod: 'voice',
    });

    const needsRemoteSearch = immediateFoods.some((food) => !food.nutrients);
    if (!needsRemoteSearch) return;

    const resolvedFoods = await Promise.all(parsedVoiceFoods.map(async (food, index) => {
      if (immediateFoods[index].nutrients) return immediateFoods[index];
      const remoteCandidates = await searchNutritionCandidatesCached(food.name);
      const normalizedName = normalizeLookupText(food.name);
      const bestCandidate = remoteCandidates.find((candidate) => normalizeLookupText(candidate.name) === normalizedName)
        || remoteCandidates.find((candidate) => {
          const candidateName = normalizeLookupText(candidate.name);
          return normalizedName.length >= 3 && (candidateName.includes(normalizedName) || normalizedName.includes(candidateName));
        })
        || remoteCandidates[0]
        || (localCandidates[index]?.nutrients ? localCandidates[index] : null);
      return createVoiceFood(food, bestCandidate);
    }));

    setCaptured((current) => current?.inputMethod === 'voice'
      ? { ...current, foods: resolvedFoods, ocrStatus: 'voice-input-db' }
      : current);
  }

  async function handleSave(options = {}) {
    if (!report || saveState === '저장 중' || saveState.includes('저장됨')) return;
    if (report.items.some((item) => !item.portionConfirmed || !item.nameConfirmed)) {
      setSaveState('음식 이름과 먹은 양을 먼저 확인해 주세요.');
      return;
    }
    if (isAnalysisUnavailable(report)) {
      setSaveState('분석 안됨');
      return;
    }
    try {
      setSaveState('저장 중');
      let overlayPhoto = '';
      try {
        overlayPhoto = await createMealOverlayPhoto(captured.photo, report);
      } catch (error) {
        console.warn('Meal overlay photo creation failed', error);
      }
      const { saveNutritionReport, readLocalReports } = await import('./services/reportStore');
      const result = await saveNutritionReport(report, { imageUrl: overlayPhoto, mealType: options.mealType, createdAt: options.createdAt });
      setSavedReports(readLocalReports());
      if (!result.saved) {
        setSaveState('저장 공간 부족 · 다시 시도');
        return;
      }
      setSaveState(result.storage === 'firebase' ? 'Firebase 저장됨' : '기기 저장됨');
      analysisRunRef.current += 1;
      setLiveScan({ status: 'scanning', facts: {}, text: '', food: null });
      setBarcodeMatch({ status: 'idle', code: '', candidate: null });
      barcodeLookupRef.current = '';
      setCaptured(null);
      if (photoQueue.length > 1) {
        const remaining = photoQueue.slice(1);
        setPhotoQueue(remaining);
        try { await startQueuedPhoto(remaining[0]); }
        catch { setQueueError('이전 식사는 저장했어요. 다음 사진을 열지 못했으니 다시 시도하거나 건너뛰어 주세요.'); }
        return;
      }
      setPhotoQueue([]);
      setDiaryDay(dateKey(options.createdAt || new Date()));
      setDiaryOpen(true);
    } catch (error) {
      console.warn('Nutrition report save failed', error);
      setSaveState('저장 실패 · 다시 시도');
    }
  }

  async function loadSavedReports() {
    const { readLocalReports } = await import('./services/reportStore');
    const reports = readLocalReports();
    setSavedReports(reports);
    return reports;
  }

  async function updateSavedReport(mealId, changes) {
    const { readLocalReports, updateNutritionReport } = await import('./services/reportStore');
    const result = await updateNutritionReport(mealId, changes);
    setSavedReports(readLocalReports());
    return result;
  }

  async function deleteSavedReport(mealId) {
    const { deleteNutritionReport, readLocalReports } = await import('./services/reportStore');
    const result = await deleteNutritionReport(mealId);
    setSavedReports(readLocalReports());
    return result;
  }

  async function restoreSavedReport(reportToRestore) {
    const { readLocalReports, restoreNutritionReport } = await import('./services/reportStore');
    const result = await restoreNutritionReport(reportToRestore);
    setSavedReports(readLocalReports());
    return result;
  }

  async function openDiary() {
    setSaveState('');
    await loadSavedReports();
    setDiaryOpen(true);
  }

  function updateProfile(next) {
    setProfile((current) => ({ ...current, ...next }));
  }

  function updateFacts(next) {
    if (Object.keys(next).some((key) => !['labelConfirmed', 'servingsConsumed', 'portionConfirmed', 'portionChoice'].includes(key))) next = { ...next, labelConfirmed: false };
    setSaveState('');
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
    setSaveState('');
    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        foods: current.foods.map((food) => {
          if (food.id !== id) return food;
          return updateFoodDetails(food, next);
        }),
      };
    });
  }

  function addFood() {
    setSaveState('');
    setCaptured((current) => {
      if (!current) return current;
      return {
        ...current,
        foods: [...current.foods, createEmptyFoodItem()],
      };
    });
  }

  function removeFood(id) {
    setSaveState('');
    setCaptured((current) => {
      if (!current) return current;
      const nextFoods = current.foods.filter((food) => food.id !== id);
      return {
        ...current,
        foods: nextFoods.length ? nextFoods : [createEmptyFoodItem()],
      };
    });
  }

  function candidateToFoodItem(candidate) {
    const servingDetails = createServingDetails(candidate.serving, candidate.servingAmount, candidate.servingUnit);
    return {
      ...createEmptyFoodItem(),
      name: candidate.name,
      nameConfirmed: true,
      portionSource: 'standard',
      portionConfirmed: false,
      grams: candidate.perServing ? String(servingDetails.amount) : candidate.grams || '100',
      estimated: false,
      visualReason: '',
      nutrients: candidate.nutrients || null,
      nutrientBasisGrams: candidate.perServing ? String(servingDetails.amount) : candidate.grams || '100',
      brand: candidate.brand || '',
      category: candidate.category || '',
      serving: candidate.serving || '',
      sourceLabel: candidate.sourceLabel || '',
      sourceUrl: candidate.sourceUrl || '',
      official: Boolean(candidate.official),
      perServing: Boolean(candidate.perServing),
      servingAmount: candidate.perServing ? servingDetails.amount : 0,
      servingUnit: candidate.perServing ? servingDetails.unit : 'g',
    };
  }

  function applyFoodCandidate(candidate) {
    setSaveState('');
    setCaptured((current) => {
      if (!current) return current;
      const nextFood = candidateToFoodItem(candidate);
      const shouldReplace = !current.foods.length || (current.foods.length === 1 && current.foods[0]?.estimated);
      return {
        ...current,
        foods: shouldReplace ? [nextFood] : [...current.foods, nextFood],
      };
    });
  }

  function confirmFoodReferences(selections, shareForLearning = false) {
    setSaveState('');
    if (shareForLearning && captured?.photo) {
      void saveRecognitionFeedback(captured, selections).catch((error) => {
        console.warn('Recognition feedback save failed', error);
      });
    }
    setCaptured((current) => {
      if (!current) return current;
      const foods = selections
        .map(({ candidate, detectedFood }) => createConfirmedFoodItem(candidate, detectedFood))
        .filter(Boolean);
      return {
        ...current,
        foods: foods.length ? foods : current.foods,
        analysisStatus: 'complete',
      };
    });
  }

  function applyNutritionFactsCandidate(candidate) {
    if (!candidate?.nutrients) return;
    setSaveState('');
    setCaptured((current) => {
      if (!current) return current;
      const candidateKey = normalizeLookupText(candidate.name);
      return {
        ...current,
        ocrStatus: 'detected',
        foods: current.foods.filter((food) => !food.estimated && normalizeLookupText(food.name) !== candidateKey),
        facts: {
          ...current.facts,
          foodName: candidate.name || current.facts.foodName,
          servingSize: candidate.serving || formatServingAmount(candidate.grams || 100, candidate.servingUnit || 'g'),
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
    <main className={`h-[100dvh] overflow-hidden bg-slate-950 text-slate-50 mode-${profile.mode}`}>
      {!report ? (
        <section className="relative h-[100dvh] min-h-[100svh] overflow-hidden bg-slate-950">
          <video
            id="camera-video"
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-cover ${cameraReady ? 'block' : 'hidden'}`}
            autoPlay
            playsInline
            muted
          />
          <canvas ref={fallbackCanvasRef} width="900" height="1200" className={`absolute inset-0 h-full w-full object-cover ${cameraReady ? 'hidden' : 'block'}`} />
          <canvas ref={canvasRef} className="hidden" />

          <div className="camera-meal-header"><div><strong>몸가짐</strong><small>1 사진 찍기 → 2 확인 → 3 저장</small></div><label className="camera-photo-button">사진 고르기<input type="file" accept="image/*" multiple className="sr-only" aria-label="음식 사진 고르기" onChange={handlePhotoUpload} /></label></div>

          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/5 to-black/80" />

          {!cameraReady ? <div className="camera-start">
            <h1>오늘 먹은 음식, 찰칵!</h1>
            <p id="camera-status">{cameraError ? '카메라 사용을 허용하거나, 위에서 사진을 골라주세요.' : '음식이 잘 보이도록 사진을 찍어주세요.'}</p>
            <button type="button" className="meal-primary" onClick={() => startCamera({ userRequested: true })}>카메라 켜기</button>
            {cameraError ? <details><summary>카메라가 안 켜지나요?</summary><p>{cameraError}</p></details> : null}
          </div> : <p className="camera-capture-hint">음식 전체가 보이면 촬영 버튼을 눌러요</p>}

          <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-20 flex items-center justify-center gap-3 px-3 sm:gap-6 sm:px-4">
            <button
              type="button"
              onClick={openDiary}
              className="flex h-14 min-w-14 flex-col items-center justify-center rounded-2xl border border-white/25 bg-black/45 px-2 font-black shadow-2xl backdrop-blur transition active:scale-95 sm:h-16 sm:min-w-16 sm:px-3"
              aria-label="오늘 기록 열기"
            >
              <span className="text-2xl leading-none" aria-hidden="true">⌂</span>
              <span className="mt-1 text-sm">내 기록</span>
            </button>
            <button
              type="button"
              onClick={handleShoot}
              disabled={!cameraReady || Boolean(cameraError)}
              className={`grid h-20 w-20 shrink-0 place-items-center rounded-full border-[6px] shadow-2xl transition sm:h-24 sm:w-24 sm:border-[7px] ${cameraReady && !cameraError ? 'border-white bg-white/15 active:scale-95' : 'cursor-not-allowed border-white/40 bg-white/5 opacity-50'}`}
              aria-label="음식 사진 찍기"
              aria-describedby={cameraError ? 'camera-status' : undefined}
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-400 text-xs font-black text-emerald-950 shadow-inner sm:h-16 sm:w-16">찰칵!</span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-14 min-w-14 flex-col items-center justify-center rounded-2xl border border-white/25 bg-black/45 px-2 font-black shadow-2xl backdrop-blur transition active:scale-95 sm:h-16 sm:min-w-16 sm:px-3"
              aria-label="설정 열기"
            >
              <span className="text-2xl leading-none" aria-hidden="true">⚙</span>
              <span className="mt-1 text-sm">내 정보</span>
            </button>
          </div>
        </section>
      ) : ['analyzing', 'searching-references', 'review'].includes(captured.analysisStatus) ? (
        <FoodReferenceReview
          captured={captured}
          loading={captured.analysisStatus !== 'review'}
          onBack={handleRetake}
          onConfirm={confirmFoodReferences}
          onAnalyzeRegion={handleAnalyzeFoodRegion}
          onManualFallback={switchToManualFoodSearch}
        />
      ) : (
        <ReportView
          key={captured.eatenAt || captured.inputMethod}
          queueRemaining={photoQueue.length}
          captured={captured}
          modeLabel={modeLabel}
          report={report}
          confidence={confidence}
          savedReports={savedReports}
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
          onSpeak={() => speak(`이번 식사는 약 ${Math.round(report.totals.calories)} 킬로칼로리예요. ${report.items.map((item) => item.name).join(', ')}. 음식과 양을 확인한 다음 저장 버튼을 눌러주세요.`)}
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
          initialDay={diaryDay}
          profile={profile}
          reports={savedReports}
          notice={saveState.includes('저장됨') ? '식사 기록을 저장했어요!' : ''}
          onRefresh={loadSavedReports}
          onUpdate={updateSavedReport}
          onDelete={deleteSavedReport}
          onRestore={restoreSavedReport}
          onUpload={handlePhotoUpload}
          onClose={() => setDiaryOpen(false)}
        />
      ) : null}
      {batchFiles ? <PhotoBatch files={batchFiles} onClose={() => { setBatchFiles(null); setPhotoQueue([]); }} onStart={startPhotoBatch} /> : null}
      {queueError ? <aside className="meal-screen photo-batch" role="dialog" aria-modal="true" aria-label="사진 업로드 오류"><div className="meal-page"><section className="meal-card"><h2>다음 사진을 확인해 주세요</h2><p role="alert">{queueError}</p><button className="meal-primary" type="button" onClick={async () => { try { await startQueuedPhoto(photoQueue[0]); } catch { setQueueError('사진을 열지 못했어요. 다른 형식의 사진을 선택해 주세요.'); } }}>다시 시도</button><button className="meal-secondary" type="button" onClick={async () => { const next = photoQueue.slice(1); setPhotoQueue(next); if (next.length) { try { await startQueuedPhoto(next[0]); } catch { setQueueError('다음 사진도 열지 못했어요.'); } } else { setQueueError(''); setDiaryOpen(true); } }}>이 사진 건너뛰기</button><button className="meal-back" type="button" onClick={() => { setPhotoQueue([]); setQueueError(''); setDiaryOpen(true); }}>남은 사진 취소 · 저장한 기록 보기</button></section></div></aside> : null}
    </main>
  );
}

function FoodReferenceReview({ captured, loading, onBack, onConfirm, onAnalyzeRegion, onManualFallback }) {
  const [extraGroups, setExtraGroups] = useState([]);
  const [omitted, setOmitted] = useState([]);
  const [selectedIds, setSelectedIds] = useState({});
  const [manualCandidates, setManualCandidates] = useState({});
  const [searchQueries, setSearchQueries] = useState({});
  const [searchStates, setSearchStates] = useState({});
  const [portionUpdates, setPortionUpdates] = useState({});
  const [positions, setPositions] = useState({});
  const [regionScanState, setRegionScanState] = useState('idle');
  const [shareForLearning, setShareForLearning] = useState(false);
  const groups = [...(captured.referenceGroups || []), ...extraGroups].filter((group) => !omitted.includes(group.id));
  const getCandidates = (group) => uniqueCandidates([...(manualCandidates[group.id] || []), ...(group.candidates || [])]).filter((candidate) => candidate?.nutrients);
  const getSelected = (group) => getCandidates(group).find((candidate) => candidate.id === selectedIds[group.id]) || getCandidates(group).find((candidate) => sameFoodName(candidate.name, group.detectedFood.name));
  const portionKey = (group) => group.id + ':' + (getSelected(group)?.id || 'unknown');
  function adjustedFood(group) {
    const candidate = getSelected(group);
    const unit = candidate?.perServing ? candidate.servingUnit || '회' : 'g';
    const base = candidate?.perServing && unit !== 'g' ? Number(candidate.servingAmount || candidate.grams) || 1 : Number(group.detectedFood.grams || candidate?.grams) || 100;
    return { ...group.detectedFood, name: candidate?.name || group.detectedFood.name, grams: String(base),
      servingUnit: unit, perServing: Boolean(candidate?.perServing), servingAmount: candidate?.servingAmount || 0,
      portionSource: group.detectedFood.portionSource || 'standard', portionConfirmed: false,
      ...portionUpdates[portionKey(group)], position: positions[group.id] || group.detectedFood.position || null };
  }
  const selections = groups.map((group) => ({ detectedFood: adjustedFood(group), candidate: getSelected(group) }));
  const canConfirm = !loading && regionScanState !== 'analyzing' && groups.length > 0 && selections.every((selection) => selection.candidate && selection.detectedFood.portionConfirmed);
  const total = selections.reduce((sum, selection) => {
    const food = createConfirmedFoodItem(selection.candidate, selection.detectedFood);
    return sum + (food ? calculateAppliedFoodCalories(food) : 0);
  }, 0);
  const photoFoods = loading ? captured.foods : groups.map((group) => ({ ...adjustedFood(group), id: group.id, name: getSelected(group)?.name || group.detectedFood.name }));
  async function search(group) {
    const query = String(searchQueries[group.id] || '').trim();
    if (!query) return;
    setSearchStates((current) => ({ ...current, [group.id]: 'searching' }));
    try {
      const remote = await searchNutritionCandidatesCached(query);
      const candidates = uniqueCandidates([...createNutritionSearchCandidates(query), ...remote.map(normalizeRemoteCandidate).filter(Boolean)]).filter((candidate) => candidate?.nutrients);
      setManualCandidates((current) => ({ ...current, [group.id]: candidates }));
      setSelectedIds((current) => ({ ...current, [group.id]: candidates.find((candidate) => sameFoodName(candidate.name, query))?.id || '' }));
      setSearchStates((current) => ({ ...current, [group.id]: candidates.length ? 'found' : 'empty' }));
    } catch {
      setSearchStates((current) => ({ ...current, [group.id]: 'error' }));
    }
  }
  async function tapRegion(event) {
    if (loading || regionScanState === 'analyzing') return;
    const rect = event.currentTarget.getBoundingClientRect();
    setRegionScanState('analyzing');
    try {
      const result = await onAnalyzeRegion({ xRatio: (event.clientX - rect.left) / rect.width, yRatio: (event.clientY - rect.top) / rect.height });
      setRegionScanState(result?.status || 'error');
    } catch { setRegionScanState('error'); }
  }
  function addMissingFood() {
    const id = 'manual-' + Date.now();
    setExtraGroups((current) => [...current, { id, detectedFood: { ...createEmptyFoodItem(), name: '추가할 음식', grams: '100' }, candidates: [], images: [] }]);
    requestAnimationFrame(() => document.getElementById('review-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
  return (
    <section className="meal-screen">
      <div className="meal-page">
        <header className="meal-header"><button type="button" className="meal-back" onClick={onBack}>← 다시 찍기</button><span className="meal-brand">몸가짐 · 식사 기록</span></header>
        <MealSteps step={2} />
        <div className="meal-page-title"><p>사진 속 음식을 찾았어요</p><h1>{loading ? '무슨 음식인지 살펴볼게요' : '음식과 양이 맞나요?'}</h1><p>{loading ? '잠깐만 기다려 주세요.' : '이름이 다르면 바꾸고, 먹은 양을 골라주세요.'}</p></div>
        <MealPhoto src={captured.photo} foods={photoFoods} busy={loading || regionScanState === 'analyzing'} onFoodClick={(food) => document.getElementById('review-' + food.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })} onPosition={!loading ? (id, position) => setPositions((current) => ({ ...current, [id]: position })) : undefined} onImageClick={tapRegion} />
        {!loading ? <p className="meal-hint">이름표를 누르면 그 음식으로 이동해요. 놓친 음식은 사진에서 눌러주세요.</p> : null}
        {regionScanState !== 'idle' ? <p className="meal-notice" role="status">{({ analyzing: '누른 음식을 다시 찾고 있어요…', found: '음식을 추가했어요. 아래에서 확인해 주세요.', duplicate: '이미 목록에 있는 음식이에요.', manual: '이름을 직접 입력할 수 있게 칸을 추가했어요.', error: '찾지 못했어요. 아래 음식 추가 버튼을 눌러주세요.' })[regionScanState]}</p> : null}
        {loading ? <div className="meal-card" role="status"><p>사진에서 음식 이름과 양을 확인하고 있어요.</p><button type="button" className="meal-secondary" onClick={onManualFallback}>기다리지 않고 이름 입력하기</button></div> : <>
          <div className="meal-review-summary"><div><span>고른 음식 {selections.filter((selection) => selection.candidate).length}개</span><strong>약 {selections.some((selection) => selection.candidate) ? Math.round(total).toLocaleString('ko-KR') : '—'} <small>kcal</small></strong></div><p>고른 음식만 더한 예상값이에요. 먹은 양을 확인해 주세요.</p></div>
          {groups.map((group, index) => {
            const candidate = getSelected(group);
            const food = adjustedFood(group);
            const applied = createConfirmedFoodItem(candidate, food);
            return <section className="meal-card review-food-card" key={group.id} id={'review-' + group.id} tabIndex={-1}>
              <div className="meal-card-heading"><span className="food-number" style={{ background: foodColors[index % foodColors.length] }}>{index + 1}</span><div><p>이 음식이 맞나요?</p><h2>{candidate?.name || group.detectedFood.name}</h2></div><button type="button" className="meal-icon-button" aria-label={(candidate?.name || group.detectedFood.name) + ' 목록에서 빼기'} onClick={() => setOmitted((current) => [...current, group.id])}>×</button></div>
              {applied ? <div className="meal-candidate-answer"><span>현재 먹은 양 기준</span><b>약 {Math.round(calculateAppliedFoodCalories(applied))} kcal</b></div> : <p className="meal-notice">음식을 찾지 못했어요. 아래에서 이름을 입력해 주세요.</p>}
              <details className="meal-details" open={!candidate || undefined}><summary>{candidate ? '다른 음식인가요? 이름 바꾸기' : '음식 이름 입력하기'}</summary>
                <form className="meal-search" onSubmit={(event) => { event.preventDefault(); search(group); }}><label htmlFor={'food-search-' + group.id}>먹은 음식 이름</label><div><input id={'food-search-' + group.id} type="search" placeholder="예: 삶은 계란" value={searchQueries[group.id] || ''} onChange={(event) => setSearchQueries((current) => ({ ...current, [group.id]: event.target.value }))} /><button type="submit" disabled={searchStates[group.id] === 'searching'}>{searchStates[group.id] === 'searching' ? '찾는 중' : '찾기'}</button></div></form>
                {['empty', 'error'].includes(searchStates[group.id]) ? <p role="status" className="meal-hint">{searchStates[group.id] === 'empty' ? '찾은 음식이 없어요. 짧은 이름으로 다시 찾아보세요.' : '연결이 끊겼어요. 다시 찾아주세요.'}</p> : null}
                <div className="meal-candidate-list">{getCandidates(group).slice(0, 8).map((option) => <button type="button" key={option.id} aria-pressed={candidate?.id === option.id} onClick={() => setSelectedIds((current) => ({ ...current, [group.id]: option.id }))}><span><b>{option.name}</b><small>{option.serving || (option.grams || 100) + 'g'} 기준 · {Math.round(Number(option.nutrients.calories) || 0)} kcal</small></span><span aria-hidden="true">{candidate?.id === option.id ? '✓' : '＋'}</span></button>)}</div>
                {group.images?.length ? <details className="meal-details"><summary>비슷한 음식 사진 보기</summary><div className="meal-reference-photos">{group.images.map((image) => <a href={image.sourceUrl} target="_blank" rel="noreferrer" key={image.id}><img loading="lazy" src={image.thumbnailUrl} alt={image.title || '참고 음식 사진'} /><small>{image.creator || image.provider} · {image.license || '공개 라이선스'}</small></a>)}</div></details> : null}
              </details>
              {candidate ? <PortionPicker key={portionKey(group)} food={food} onChange={(next) => setPortionUpdates((current) => ({ ...current, [portionKey(group)]: { ...current[portionKey(group)], ...next } }))} /> : null}
              {applied ? <FoodEvidence item={{ ...applied, nameConfirmed: false, matched: true }} /> : null}
            </section>;
          })}
          <button type="button" className="meal-secondary" onClick={addMissingFood}>＋ 빠진 음식 추가하기</button>
          {omitted.length ? <button type="button" className="meal-text-button" onClick={() => setOmitted([])}>뺀 음식 다시 넣기</button> : null}
          <details className="meal-details meal-hint"><summary>선택사항: 음식 인식 개선 돕기</summary><label className="meal-consent"><input type="checkbox" checked={shareForLearning} onChange={(event) => setShareForLearning(event.target.checked)} />음식 사진과 선택 결과를 익명으로 저장하는 데 동의해요. 체크하지 않아도 기록할 수 있어요.</label></details>
        </>}
      </div>
      {!loading ? <div className="meal-bottom-bar"><p>{canConfirm ? '음식과 양을 확인했다면 다음으로 가요.' : regionScanState === 'analyzing' ? '추가한 음식을 확인하는 중이에요.' : '음식 이름과 먹은 양을 확인해 주세요.'}</p><button type="button" className="meal-primary" disabled={!canConfirm} onClick={() => onConfirm(selections, shareForLearning)}>맞아요 · 결과 보기 →</button></div> : null}
    </section>
  );
}

function ReportView({
  captured, report, confidence, saveState, savedReports, updateFood, addFood, removeFood,
  updateFacts, applyFoodCandidate, applyNutritionFactsCandidate, uploadNutritionLabel, onBack, onSave, onSpeak, queueRemaining = 0,
}) {
  const [mealType, setMealType] = useState(() => captured.mealType || mealTypeAt(captured.eatenAt || new Date()));
  const [dateTime, setDateTime] = useState(() => localDateTime(captured.eatenAt || new Date()));
  const [timeConfirmed, setTimeConfirmed] = useState(captured.timeConfirmed ?? true);
  const [showEditor, setShowEditor] = useState(false);
  const childMode = report.profile.mode === 'child';
  const analysisUnavailable = isAnalysisUnavailable(report);
  const needsFoodConfirmation = report.items.some((item) => item.type !== '영양성분표' && !item.nameConfirmed);
  const needsPortionConfirmation = report.items.some((item) => !item.portionConfirmed);
  const needsLabelConfirmation = report.items.some((item) => item.type === '영양성분표' && !item.nameConfirmed);
  const saveBusy = saveState === '저장 중';
  const validTime = dateTime && Number.isFinite(new Date(dateTime).getTime()) && new Date(dateTime) <= new Date();
  const saveDisabled = analysisUnavailable || needsFoodConfirmation || needsPortionConfirmation || needsLabelConfirmation || !validTime || !timeConfirmed || saveBusy || saveState.includes('저장됨');
  const todayCalories = diaryStats(savedReports || [], 'today', dateKey(dateTime) || dateKey()).totals.calories;
  const hasPending = report.items.some((item) => item.isPendingInfo);
  function focusFood(food, index) {
    const card = document.getElementById('food-result-' + (food.id || index));
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.focus({ preventScroll: true });
  }
  return <section className="meal-screen"><div className="meal-page">
    <header className="meal-header"><button type="button" className="meal-back" onClick={onBack}>← {captured.inputMethod === 'voice' ? '처음으로' : '다시 찍기'}</button><button type="button" className="meal-back" onClick={onSpeak}>🔊 결과 듣기</button></header>
    <MealSteps step={3} />
    <div className="meal-page-title"><p>차곡차곡, 나의 식사</p><h1>오늘 먹은 한 끼</h1><p>이름표를 누르면 음식별 정보를 볼 수 있어요.</p></div>
    <MealPhoto src={captured.photo} foods={captured.foods.filter((food) => food.name)} onFoodClick={focusFood} onPosition={(id, position) => updateFood(id, { position })} />
    <section className="meal-card meal-total-card" aria-label="한 끼 영양 요약">
      <div className="meal-total-heading"><span>이번 식사의 에너지</span><span className="meal-estimate">{hasPending ? '일부 정보 확인 필요' : '예상 칼로리'}</span></div>
      <p className="meal-calorie-number">{analysisUnavailable ? '—' : '약 ' + Math.round(report.totals.calories).toLocaleString('ko-KR')} <span>kcal</span></p>
      <p className="meal-hint">{hasPending ? '영양정보가 있는 음식만 더했어요.' : '음식 종류와 먹은 양에 따라 실제 값은 달라질 수 있어요.'}</p>
      <MacroBar totals={report.totals} />
      <details className="meal-details"><summary>{childMode ? '골고루 먹는 습관' : '선택한 날의 기록과 함께 보기'}</summary><DailyBudget goal={estimateDailyCalorieGoal(report.profile)} consumed={todayCalories} mealCalories={report.totals.calories} childMode={childMode} /></details>
    </section>
    <section className="meal-card"><label className="meal-field">언제 먹었나요?<select value={mealType} onChange={(event) => setMealType(event.target.value)}>{['아침', '점심', '저녁', '간식·기타'].map((value) => <option key={value}>{value}</option>)}</select></label><label className="meal-field">식사 날짜와 시간<input type="datetime-local" max={localDateTime()} value={dateTime} onChange={(e) => { setDateTime(e.target.value); setTimeConfirmed(true); setMealType(mealTypeAt(e.target.value)); }} /></label><label className="journal-complete"><input type="checkbox" checked={timeConfirmed} onChange={(e) => setTimeConfirmed(e.target.checked)} />이 식사 시간이 맞아요</label>{captured.timeSource === 'manual' ? <p className="meal-hint">사진에 촬영 시간이 없어요. 임시 시간 대신 실제 먹은 시간을 확인해 주세요.</p> : null}{!validTime ? <p className="meal-hint" role="alert">실제 먹은 날짜와 시간을 입력해 주세요. 미래 시간은 저장할 수 없어요.</p> : null}{queueRemaining > 0 ? <p className="meal-notice">현재 사진 포함 {queueRemaining}장 남았어요. 이 식사를 저장하면 다음 사진으로 넘어가요.</p> : null}</section>
    <div className="meal-section-heading"><h2>음식별로 살펴보기</h2><span>{report.items.length}가지</span></div>
    {report.items.map((item, index) => {
      const food = captured.foods.find((entry) => entry.id === item.id);
      return <FoodNutritionCard key={item.id || index} item={item} index={index} food={food} onUpdate={updateFood} onRemove={captured.foods.length > 1 ? removeFood : undefined}>
        {food ? <FoodItemsForm foods={[food]} updateFood={updateFood} removeFood={removeFood} compact /> : item.type === '영양성분표' ? <>
          <PortionPicker food={{ ...item, perServing: true, servingAmount: 1 }} onChange={(next) => updateFacts({ servingsConsumed: next.grams ?? captured.facts.servingsConsumed, portionConfirmed: next.portionConfirmed, portionChoice: next.portionChoice || '' })} />
          <p className="meal-hint">위 숫자는 포장지에 적힌 분량 기준이에요. 먹은 회분을 골라주세요.</p>
          <details className="meal-details" open={!captured.facts.labelConfirmed || undefined}><summary>포장지 숫자 확인하기</summary><NutritionFactsForm facts={captured.facts} updateFacts={updateFacts} /></details>
        </> : null}
      </FoodNutritionCard>;
    })}
    <button type="button" className="meal-secondary" onClick={() => setShowEditor(!showEditor)} aria-expanded={showEditor}>{showEditor ? '음식 추가 닫기' : '＋ 음식 추가·이름으로 찾기'}</button>
    {showEditor || analysisUnavailable ? <div className="meal-card"><NutritionLookupPanel captured={captured} onApplyFood={applyFoodCandidate} onApplyFacts={applyNutritionFactsCandidate} onUploadLabel={uploadNutritionLabel} /><details className="meal-details"><summary>음식 직접 입력하기</summary><FoodItemsForm foods={captured.foods} updateFood={updateFood} addFood={addFood} removeFood={removeFood} /></details></div> : null}
    <p className="meal-hint">드레싱·소스나 빠진 반찬이 있으면 음식 추가에서 함께 기록해 주세요.</p>
    <details className="meal-card meal-details"><summary>포장지 영양정보 입력하기</summary><p className="meal-hint">과자·음료 포장지의 영양정보를 적을 수 있어요.</p><NutritionFactsForm facts={captured.facts} updateFacts={updateFacts} /></details>
    <details className="meal-card meal-details"><summary>분석 근거 자세히 보기</summary><MeasurementConfidenceStrip confidence={confidence} />{!childMode ? <CoachReportCard report={report} /> : <OfficialSourceList sources={report.sourceItems || []} />}</details>
    {saveState && !saveBusy ? <p className="meal-notice" role="status">{saveState}</p> : null}
  </div><div className="meal-bottom-bar"><p>{analysisUnavailable ? '음식 이름을 먼저 찾아주세요.' : needsFoodConfirmation ? '위에서 음식 이름을 확인해 주세요.' : needsPortionConfirmation ? '각 음식에서 먹은 양을 골라주세요.' : needsLabelConfirmation ? '포장지 숫자를 확인해 주세요.' : !timeConfirmed || !validTime ? '위에서 식사 날짜와 시간을 확인해 주세요.' : '저장하면 나의 식사 기록에서 볼 수 있어요.'}</p><button className="meal-primary" type="button" disabled={saveDisabled} onClick={() => onSave({ mealType, createdAt: new Date(dateTime).toISOString() })}>{saveBusy ? '저장하고 있어요…' : '✓ 이 식사 저장하기'}</button></div></section>;
}

function MeasurementConfidenceStrip({ confidence }) {
  if (!confidence || confidence.level === 'none') return null;
  const styles = {
    high: { chip: 'bg-emerald-600 text-white', panel: 'border-emerald-300 bg-emerald-50', text: 'text-emerald-800' },
    medium: { chip: 'bg-amber-500 text-amber-950', panel: 'border-amber-300 bg-amber-50', text: 'text-amber-800' },
    low: { chip: 'bg-red-600 text-white', panel: 'border-red-300 bg-red-50', text: 'text-red-800' },
  }[confidence.level];
  const { tiers, agreement } = confidence;

  return (
    <div className={`rounded-lg border p-4 ${styles.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${styles.chip}`}>{confidence.label}</span>
          <strong className="text-sm font-black">입력·출처 확인</strong>
        </div>
        {agreement ? (
          <span className={`text-xs font-bold tabular-nums ${styles.text}`}>
            실시간 {agreement.liveCalories} kcal → 최종 {agreement.finalCalories} kcal
          </span>
        ) : null}
      </div>
      <ul className={`mt-2 grid gap-1 text-xs font-bold leading-relaxed ${styles.text}`}>
        {confidence.reasons.map((reason) => <li key={reason}>· {reason}</li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black">
        {tiers.official > 0 ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">{TRUST_TIER_LABEL.official} {tiers.official}</span> : null}
        {tiers.matched > 0 ? <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-cyan-800">{TRUST_TIER_LABEL.matched} {tiers.matched}</span> : null}
        {tiers.estimated > 0 ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">{TRUST_TIER_LABEL.estimated} {tiers.estimated}</span> : null}
        {tiers.pending > 0 ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">{TRUST_TIER_LABEL.pending} {tiers.pending}</span> : null}
      </div>
    </div>
  );
}

function CoachReportCard({ report, analysisPending = false }) {
  const traffic = createTrafficFeedback(report);
  const coachLine = createCoachLine(report);
  const analysisUnavailable = isAnalysisUnavailable(report);
  const badgeStyles = {
    green: 'border-emerald-200 bg-emerald-100 text-emerald-800',
    yellow: 'border-amber-200 bg-amber-100 text-amber-900',
    red: 'border-red-200 bg-red-100 text-red-800',
  }[report.stamp];

  return (
    <section className="rounded-lg border-2 border-slate-950 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-teal-700">3단계 식사 영양 참고 정보</p>
          <h2 className="mt-1 text-2xl font-black sm:text-3xl">식사 참고 정보</h2>
        </div>
        <span className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-black sm:px-4 ${analysisPending || analysisUnavailable ? 'border-slate-800 bg-slate-950 text-white' : badgeStyles}`}>
          {analysisPending ? '분석 중' : analysisUnavailable ? '분석 안됨' : traffic.badge}
        </span>
      </div>

      <div className="mt-5 grid gap-4">
        <ReportLine
          title="총 칼로리"
          body={
            analysisPending
              ? '음식 DB와 비교해 칼로리를 계산하고 있습니다'
              : analysisUnavailable
              ? '분석이 안됩니다'
              : `${formatMetric(report.totals.calories, 'kcal')} · 탄수화물 ${report.macroPercent.carb}% · 단백질 ${report.macroPercent.protein}% · 지방 ${report.macroPercent.fat}%`
          }
          strong
        />
        <ReportLine
          title="인식 음식·반찬 및 수량"
          body={analysisPending ? '사진에서 음식명과 중량을 확인하고 있습니다' : analysisUnavailable ? '분석이 안됩니다' : report.items.length ? report.items.map(formatReportItemLabel).join(', ') : '촬영 음식 250g 기준 자동 추정'}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ReportLine title="🏅 식단 점수" body={analysisPending ? '칼로리 계산 후 평가합니다' : analysisUnavailable ? '분석이 안됩니다' : `${report.dietScore?.value ?? 0}점 · ${report.dietScore?.label || '보류'}`} />
          {analysisPending ? <ReportLine title="🩸 혈당 관리" body="음식 분석 후 평가합니다" /> : analysisUnavailable ? <ReportLine title="🩸 혈당 관리" body="분석이 안됩니다" /> : <GlycemicReportCard glycemic={report.glycemic} />}
        </div>
        {report.items.some((item) => item.isPendingInfo) ? (
          <PendingInfoNotice items={report.items.filter((item) => item.isPendingInfo)} />
        ) : null}
        {report.sourceItems?.length ? <OfficialSourceList sources={report.sourceItems} /> : null}
        {report.additives?.length ? <AdditiveNotice additives={report.additives} /> : null}

        {!analysisPending ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-lg font-black">🚦 맞춤형 식단 평가</h3>
          <div className="mt-3 grid gap-2">
            <TrafficLine color="green" label="초록 (안전/적절)" text={traffic.green} />
            <TrafficLine color="yellow" label="노랑 (주의/모니터링)" text={traffic.yellow} />
            <TrafficLine color="red" label="빨강 (경고/제한)" text={traffic.red} />
          </div>
        </div> : null}

        <ReportLine title="💡 식사 참고 한마디" body={analysisPending ? '촬영 결과를 계산하고 있습니다. 잠시만 기다려 주세요.' : coachLine} strong />
      </div>
    </section>
  );
}

function AnalysisPendingNotice() {
  return (
    <div className="flex items-center gap-4 rounded-lg border-2 border-teal-300 bg-teal-50 p-4 text-teal-950" role="status" aria-live="polite">
      <span className="h-7 w-7 shrink-0 animate-spin rounded-full border-4 border-teal-200 border-t-teal-700" aria-hidden="true" />
      <div>
        <h2 className="text-xl font-black">사진 분석 중</h2>
        <p className="mt-1 text-sm font-bold leading-snug">음식명과 촬영량을 확인한 뒤 영양 DB와 비교해 칼로리를 자동 계산합니다.</p>
      </div>
    </div>
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
  if (item.serving) {
    const consumed = item.perServing ? ` · 섭취 ${formatServingAmount(item.grams, item.servingUnit || '회')}` : '';
    return `${item.name} (${item.serving}${consumed})`;
  }
  const portion = [
    item.quantity ? `약 ${item.quantity}${item.unitLabel || '개'}` : '',
    item.sizeLabel ? `${item.sizeLabel} 크기` : '',
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
  return source.type === 'external-source' ? '외부 출처 확인 (공식 아님)' : '출처 확인';
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

function BarcodeMatchBanner({ barcodeMatch }) {
  if (barcodeMatch.status === 'looking-up') {
    return (
      <div className="absolute left-4 right-4 top-[18.5rem] z-10 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-xs font-black text-white shadow-2xl backdrop-blur md:right-auto md:max-w-[520px]">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-emerald-300" aria-hidden="true" />
        바코드 {barcodeMatch.code} 조회 중
      </div>
    );
  }
  if (barcodeMatch.status === 'found' && barcodeMatch.candidate) {
    return (
      <div className="absolute left-4 right-4 top-[18.5rem] z-10 rounded-full border border-emerald-300/50 bg-emerald-600/80 px-4 py-2 text-xs font-black text-white shadow-2xl backdrop-blur md:right-auto md:max-w-[520px]">
        바코드 제품 확인: {barcodeMatch.candidate.name} · 촬영하면 우선 적용됩니다
      </div>
    );
  }
  if (barcodeMatch.status === 'not-found') {
    return (
      <div className="absolute left-4 right-4 top-[18.5rem] z-10 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-xs font-black text-white/80 shadow-2xl backdrop-blur md:right-auto md:max-w-[520px]">
        등록되지 않은 바코드입니다. 사진 인식을 계속합니다.
      </div>
    );
  }
  return null;
}

function LiveNutritionBadge({ liveScan }) {
  const detectedFacts = getDetectedFactLabels(liveScan?.facts);

  if (detectedFacts.length) {
    const preview = detectedFacts.slice(0, 3).join(' · ');
    const extraCount = detectedFacts.length - 3;
    return (
      <div className="absolute left-4 right-4 top-[21.5rem] z-10 rounded-full border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 text-xs font-black text-emerald-50 shadow-xl backdrop-blur md:right-auto md:max-w-[520px]">
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
      <div className="absolute left-4 right-4 top-4 z-10 rounded-2xl border border-white/15 bg-black/55 p-4 text-white shadow-2xl backdrop-blur md:left-auto md:right-4 md:w-[380px]" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm font-black">실시간 칼로리 측정</strong>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${unsupported ? 'bg-amber-300 text-amber-950' : 'bg-white/10 text-white/75'}`}>
            {unsupported ? '제한' : '분석 중'}
          </span>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <strong className="text-4xl font-black tracking-tight">--</strong>
          <span className="pb-1 text-lg font-black text-emerald-200">kcal</span>
        </div>
        <p className="mt-2 text-xs font-bold leading-relaxed text-white/75">
          {unsupported
            ? '음식을 원 안에 맞추면 외형으로 우선 계산합니다. 성분표 문자는 촬영 후 직접 보완할 수 있습니다.'
            : '음식이나 성분표를 원 안에 크게 맞추세요. 약 1초마다 열량을 다시 계산하고 여러 화면을 누적해 값을 안정화합니다.'}
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
  const estimate = createLiveCalorieEstimate(liveReport, liveScan);

  return (
    <div className="absolute left-4 right-4 top-4 z-10 rounded-2xl border border-white/15 bg-black/60 p-4 text-white shadow-2xl backdrop-blur md:left-auto md:right-4 md:w-[380px]" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <strong className="block text-sm font-black">실시간 칼로리 측정</strong>
          <span className="text-[11px] font-bold text-white/60">{estimate.sourceLabel}</span>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${stamp.className}`}>{stamp.label}</span>
      </div>
      <div className="mt-2 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-3">
        <div className="flex items-end gap-2">
          <strong className="text-4xl font-black tracking-tight text-emerald-100">{estimate.calories}</strong>
          <span className="pb-1 text-lg font-black text-emerald-200">kcal</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-black">
          <span className="text-white/90">예상 범위 {estimate.low}–{estimate.high} kcal</span>
          <span className="text-emerald-200">신뢰도 {estimate.confidencePercent}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-300 transition-all duration-500" style={{ width: `${estimate.confidencePercent}%` }} />
        </div>
        <p className="mt-2 text-xs font-black text-white/85">{estimate.foodLabel}</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <LiveMetric label="당류" value={formatMetric(liveReport.totals.sugar, 'g')} />
        <LiveMetric label="나트륨" value={formatMetric(liveReport.totals.sodium, 'mg')} />
      </div>
      <p className="mt-2 max-h-10 overflow-hidden text-xs font-bold leading-snug text-white/80">{primaryRisk}</p>
      <p className="mt-2 border-t border-white/10 pt-2 text-[11px] font-black text-amber-100/90">
        사진 기반 추정 범위입니다. 저장 전 음식과 양을 확인하세요.
      </p>
    </div>
  );
}

function createLiveCalorieEstimate(liveReport, liveScan) {
  const calories = Math.max(0, Math.round(Number(liveReport?.totals?.calories || 0)));
  const hasNutritionFacts = hasReadableNutritionFacts(liveScan?.facts);
  const sampleCount = Math.max(1, Number(liveScan?.sampleCount || 1));
  const rawConfidence = hasNutritionFacts ? 0.96 : Number(liveScan?.food?.confidenceScore || 0.55);
  const confidence = Math.min(0.98, Math.max(0.35, rawConfidence));
  let uncertainty = hasNutritionFacts ? 0.05 : confidence >= 0.9 ? 0.12 : confidence >= 0.8 ? 0.18 : confidence >= 0.7 ? 0.25 : 0.35;
  if (!hasNutritionFacts && sampleCount < 3) uncertainty += 0.08;

  const roundRange = (value) => Math.max(0, Math.round(value / 5) * 5);
  const grams = Math.round(Number(liveScan?.food?.grams || 0));
  const foodName = String(liveScan?.food?.name || '').trim();

  return {
    calories,
    low: roundRange(calories * (1 - uncertainty)),
    high: roundRange(calories * (1 + uncertainty)),
    confidencePercent: Math.round(confidence * 100),
    sourceLabel: hasNutritionFacts ? '성분표 기반 계산' : sampleCount >= 4 ? '다중 화면 안정화 완료' : `화면 누적 보정 ${sampleCount}/4`,
    foodLabel: foodName ? `${foodName}${grams > 0 ? ` · 약 ${grams} g` : ''}` : '성분표에서 열량을 계산했습니다.',
  };
}

function LiveMetric({ label, value }) {
  return (
    <div className="rounded-xl bg-white/10 p-2">
      <div className="text-[11px] font-black text-white/60">{label}</div>
      <div className="mt-0.5 text-sm font-black">{value}</div>
    </div>
  );
}

function VoiceInputButton({ onResult, label = '음성 입력', compact = false, cameraMode = false }) {
  const recognitionRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => () => {
    recognitionRef.current?.abort();
  }, []);

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function startListening() {
    if (!supported) {
      setMessage('이 브라우저는 음성 입력을 지원하지 않습니다. Chrome 또는 Edge에서 이용해주세요.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStatus('listening');
      setMessage('듣고 있어요. 음식명이나 제품명을 말씀해주세요.');
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      if (transcript) {
        onResult(transcript);
        setMessage(`입력됨: ${transcript}`);
      }
    };
    recognition.onerror = (event) => {
      const errorMessages = {
        'not-allowed': '마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.',
        'audio-capture': '사용할 수 있는 마이크를 찾지 못했습니다.',
        'no-speech': '음성이 들리지 않았습니다. 다시 눌러 말씀해주세요.',
        network: '음성 인식 연결에 실패했습니다. 네트워크를 확인해주세요.',
      };
      setMessage(errorMessages[event.error] || '음성 입력에 실패했습니다. 다시 시도해주세요.');
      setStatus('idle');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus('idle');
    };

    try {
      recognition.start();
    } catch {
      setStatus('idle');
      setMessage('음성 입력을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  }

  const listening = status === 'listening';
  return (
    <span className="relative block">
      <button
        type="button"
        onClick={listening ? stopListening : startListening}
        aria-label={listening ? '음성 입력 중지' : label}
        aria-pressed={listening}
        title={supported ? (listening ? '음성 입력 중지' : label) : '이 브라우저에서는 음성 입력을 지원하지 않습니다'}
        className={cameraMode
          ? `flex h-14 min-w-14 flex-col items-center justify-center rounded-2xl border px-2 font-black shadow-2xl backdrop-blur transition active:scale-95 sm:h-16 sm:min-w-16 sm:px-3 ${
            listening ? 'animate-pulse border-red-300 bg-red-500 text-white' : 'border-white/25 bg-black/45 text-white'
          }`
          : `${compact ? 'h-11' : 'h-12'} grid w-12 place-items-center rounded-lg border-2 transition ${
            listening
              ? 'animate-pulse border-red-500 bg-red-500 text-white'
              : supported
                ? 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
                : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
          }`}
      >
        {listening ? (
          <span className="h-4 w-4 rounded-sm bg-current" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
          </svg>
        )}
        {cameraMode ? <span className="mt-0.5 text-[11px] leading-none">{listening ? '중지' : '음성'}</span> : null}
      </button>
      {message ? (
        <span
          className={cameraMode
            ? 'fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-30 mx-auto max-w-sm rounded-2xl bg-slate-950/95 px-4 py-3 text-center text-sm font-black text-white shadow-2xl'
            : 'sr-only'}
          role="status"
          aria-live="polite"
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}

function FoodItemsForm({ foods, updateFood, addFood, removeFood, compact = false }) {
  const namedFoodCount = foods.filter((food) => String(food.name || '').trim()).length;
  const fruitCount = foods.reduce((total, food) => total + (isFruitFood(food) ? Number(food.quantity || 0) : 0), 0);

  return (
    <div className="mt-4 grid gap-3">
      {!compact ? <div className="flex flex-wrap items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm font-black text-teal-900">
        <span>음식·반찬 {namedFoodCount}가지</span>
        {fruitCount > 0 ? <span className="rounded-full bg-white px-3 py-1 text-emerald-800">과일 {fruitCount}개</span> : null}
      </div> : null}
      {foods.map((food, index) => (
        <div key={food.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm font-black text-slate-600">음식 {index + 1}</strong>
            <div className="flex items-center gap-2">
              {food.estimated || !food.nameConfirmed ? (
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
          {food.estimated || !food.nameConfirmed ? (
            <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-black text-amber-900">
                {food.visualReason ? `사진 후보: ${food.visualReason}` : '사진만으로는 확정하지 않습니다.'}
              </p>
              {food.quantity || food.sizeLabel || food.confidence ? (
                <div className="flex flex-wrap gap-2 text-xs font-black">
                  {food.quantity ? <span className="rounded-full bg-white px-3 py-1 text-emerald-800">수량 약 {food.quantity}{food.unitLabel || '개'}</span> : null}
                  {food.sizeLabel ? <span className="rounded-full bg-white px-3 py-1 text-emerald-800">크기 {food.sizeLabel}</span> : null}
                </div>
              ) : null}
              {food.requiresConfirmation || !food.nameConfirmed ? (
                <button
                  type="button"
                  onClick={() => updateFood(food.id, { requiresConfirmation: false, estimated: false, visualReason: '', nameConfirmed: true })}
                  className="h-11 rounded-lg bg-amber-900 px-4 text-sm font-black text-white"
                >
                  이 음식이 맞아요
                </button>
              ) : null}
              <QuickFoodPresetSelect foodId={food.id} onApply={updateFood} />
            </div>
          ) : null}
          <label className="grid gap-1 text-sm font-black">
            음식명
            <span className="grid grid-cols-[minmax(0,1fr)_3rem] gap-2">
              <input
                value={food.name}
                onChange={(event) => updateFood(food.id, { name: event.target.value, estimated: false, visualReason: '', requiresConfirmation: false })}
                onBlur={() => recordRecognitionCorrection({ ...food, name: food.recognizedName || food.name }, food.name)}
                className="h-12 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-base"
                placeholder="예: 현미밥, 닭가슴살, 김치"
              />
              <VoiceInputButton
                onResult={(transcript) => updateFood(food.id, { name: transcript, estimated: false, visualReason: '', requiresConfirmation: false })}
                label={`음식 ${index + 1} 이름 음성 입력`}
              />
            </span>
          </label>
          <label className="grid gap-1 text-sm font-black">
            먹은 양 (숫자 입력)
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
              <input
                value={food.grams}
                type="number"
                inputMode="decimal"
                min={food.perServing ? String(getServingInputStep(food.servingUnit)) : '1'}
                max={food.perServing ? String(getServingInputMax(food.servingAmount, food.servingUnit)) : '5000'}
                step={food.perServing ? String(getServingInputStep(food.servingUnit)) : '1'}
                onChange={(event) => updateFood(food.id, { grams: event.target.value, estimated: false, visualReason: '' })}
                className="h-12 min-w-0 flex-1 px-3 text-base outline-none"
                placeholder={food.perServing ? String(food.servingAmount || 1) : '100'}
              />
              <span className="grid w-14 place-items-center bg-slate-100 text-xs text-slate-500">{food.perServing ? food.servingUnit || '회' : 'g'}</span>
            </div>
            {food.perServing && food.serving ? (
              <span className="text-xs font-bold text-slate-500">
                1회 기준: {food.serving}
                {food.nutrients ? ` · ${formatCompactNumber(food.nutrients.calories)} kcal` : ''}
                {food.nutrients ? ` · 현재 적용 ${formatCompactNumber(calculateAppliedFoodCalories(food))} kcal` : ''}
              </span>
            ) : null}
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <label className="grid gap-1 text-sm font-black">
              개수·수량
              <input
                value={food.quantity || ''}
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="0.5"
                onChange={(event) => updateFood(food.id, createQuantityUpdate(food, event.target.value))}
                className="h-12 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-base"
                placeholder="예: 3"
              />
            </label>
            <label className="grid gap-1 text-sm font-black">
              단위
              <select
                value={food.unitLabel || '개'}
                onChange={(event) => updateFood(food.id, { unitLabel: event.target.value })}
                className="h-12 rounded-lg border border-slate-200 bg-white px-3 text-base"
              >
                {['개', '가지', '조각', '공기', '그릇', '컵', '접시', '줌'].map((unit) => <option key={unit}>{unit}</option>)}
              </select>
            </label>
          </div>
          {!food.estimated ? <QuickFoodPresetSelect foodId={food.id} onApply={updateFood} compact /> : null}
        </div>
      ))}

      {addFood ? <button
        type="button"
        onClick={addFood}
        className="h-12 rounded-lg border-2 border-dashed border-slate-300 bg-white font-black text-slate-700"
      >
        음식 추가
      </button> : null}
    </div>
  );
}

function isFruitFood(food) {
  if (food?.foodType === 'fruit') return true;
  const text = `${food?.name || ''} ${food?.category || ''}`.toLowerCase().replace(/\s+/g, '');
  return ['과일', '바나나', '사과', '배', '귤', '오렌지', '포도', '딸기', '수박', '참외', '키위', '복숭아', '토마토'].some((term) => text.includes(term));
}

function createQuantityUpdate(food, value) {
  const quantity = Math.max(0, Math.min(100, Number(value || 0)));
  if (!quantity || (food.unitLabel && food.unitLabel !== '개')) return { quantity: value };

  const normalizedName = String(food.name || '').toLowerCase().replace(/\s+/g, '');
  const unitWeights = [
    { keys: ['방울토마토'], grams: 15 },
    { keys: ['바나나'], grams: 100 },
    { keys: ['사과'], grams: 250 },
    { keys: ['귤', '만다린'], grams: 80 },
    { keys: ['오렌지'], grams: 200 },
    { keys: ['딸기'], grams: 20 },
    { keys: ['포도'], grams: 8 },
    { keys: ['키위'], grams: 100 },
    { keys: ['복숭아'], grams: 250 },
    { keys: ['토마토'], grams: 180 },
    { keys: ['계란', '달걀'], grams: 50 },
    { keys: ['고구마'], grams: 150 },
  ];
  const matched = unitWeights.find((item) => item.keys.some((key) => sameFoodName(normalizedName, key)));
  return matched ? { quantity: String(quantity), grams: String(quantity * matched.grams), portionSource: 'household', portionConfirmed: true, portionChoice: '' } : { quantity: String(quantity), portionConfirmed: false, portionSource: 'unknown' };
}

async function createMealOverlayPhoto(photo) {
  if (!photo) return '';
  const image = await loadImage(photo);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, 720 / Math.max(width, height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height);
  // Keep the photo clean so edits never leave an old calorie value burned in.
  return canvas.toDataURL('image/jpeg', .72);
}

function QuickFoodPresetSelect({ foodId, onApply, compact = false }) {
  function handleChange(event) {
    const preset = foodCorrectionPresets[Number(event.target.value)];
    if (!preset) return;
    onApply(foodId, { name: preset.name, grams: preset.grams, estimated: false, visualReason: '', confidence: '', quantity: '', sizeLabel: '', requiresConfirmation: false });
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
        포장지 숫자의 기준 분량
        <input
          value={facts.servingSize}
          onChange={(event) => updateFacts({ servingSize: event.target.value })}
          className="h-11 rounded-lg border border-slate-200 px-3 text-base"
          placeholder="예: 1봉 50g"
        />
      </label>
      <label className="meal-consent"><input type="checkbox" checked={Boolean(facts.labelConfirmed)} onChange={(event) => updateFacts({ labelConfirmed: event.target.checked })} />제품 이름·표시 분량·아래 숫자가 포장지와 같아요</label>
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [remoteStatus, setRemoteStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [remoteSearch, setRemoteSearch] = useState({ query: '', candidates: [] });
  const activeQuery = submittedQuery && submittedQuery === query.trim() ? submittedQuery : '';
  const localCandidates = useMemo(() => (activeQuery ? createNutritionSearchCandidates(activeQuery) : []), [activeQuery]);
  const remoteCandidates = remoteSearch.query === activeQuery ? remoteSearch.candidates : [];
  const candidates = useMemo(() => uniqueCandidates([...localCandidates, ...remoteCandidates]).slice(0, 10), [localCandidates, remoteCandidates]);
  const sourceLinks = useMemo(() => (activeQuery ? createOfficialSearchLinks(activeQuery, candidates) : []), [activeQuery, candidates]);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadStatus('성분표 읽는 중');
    const result = await onUploadLabel(file);
    setUploadStatus(result.message);
    event.target.value = '';
  }

  async function handleRemoteSearch(event) {
    event?.preventDefault();
    const searchTerm = query.trim();
    if (!searchTerm) {
      setSubmittedQuery('');
      setRemoteStatus('검색어를 입력하세요');
      return;
    }

    setSubmittedQuery(searchTerm);
    setSearching(true);
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
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-14 w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls="nutrition-lookup-content"
      >
        <span>
          <strong className="block text-base font-black text-slate-950">제품·외식 메뉴 검색</strong>
          <span className="mt-0.5 block text-xs font-bold text-slate-500">필요할 때 열어 공식 영양정보를 찾아보세요.</span>
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-lg font-black text-white" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open ? <div id="nutrition-lookup-content" className="grid gap-3 border-t border-slate-200 p-3">
        <form className="grid gap-2" onSubmit={handleRemoteSearch}>
          <label className="grid gap-1 text-sm font-black">
            검색어
            <span className="grid grid-cols-[minmax(0,1fr)_3rem] gap-2">
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSubmittedQuery('');
                  setRemoteStatus('');
                }}
                className="h-11 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-base"
                placeholder="예: 스타벅스 라떼, 빅맥, 현미밥"
              />
              <VoiceInputButton
                onResult={(transcript) => {
                  setQuery(transcript);
                  setSubmittedQuery('');
                  setRemoteStatus('');
                }}
                label="제품·외식 메뉴 검색어 음성 입력"
                compact
              />
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={searching}
              className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-black text-white disabled:opacity-60"
            >
              {searching ? '검색 중' : '검색'}
            </button>
            <label className="grid h-10 cursor-pointer place-items-center rounded-lg bg-slate-950 px-4 text-sm font-black text-white">
              성분표 업로드
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>
            {remoteStatus ? (
              <span className="grid min-h-10 place-items-center rounded-lg bg-white px-3 text-xs font-black text-slate-600" role="status">{remoteStatus}</span>
            ) : null}
            {uploadStatus ? (
              <span className="grid min-h-10 place-items-center rounded-lg bg-white px-3 text-xs font-black text-slate-600" role="status">{uploadStatus}</span>
            ) : null}
          </div>
        </form>

      {activeQuery ? <div className="grid gap-2">
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
                  <CandidateMetric label={candidate.perServing ? '1회 kcal' : 'kcal'} value={candidate.nutrients.calories} />
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
                  식단에 추가
                </button>
                {candidate.nutrients ? (
                  <button
                    type="button"
                    onClick={() => onApplyFacts(candidate)}
                    className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700"
                  >
                    성분표로 대체
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
      </div> : null}

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
      </div> : null}
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
  const servingDetails = createServingDetails(entry.serving);
  return {
    id: `${kind}-${name}-${entry.sourceUrl || ''}`,
    kind,
    name,
    grams: String(servingDetails.amount),
    serving: entry.serving || '',
    brand: entry.brand || '',
    category: entry.category || (kind === 'official-product' ? '공식 제품 DB' : '외식 공식 메뉴'),
    sourceLabel: entry.sourceLabel || '공식 영양정보',
    sourceUrl: entry.sourceUrl || '',
    imageUrl: entry.imageUrl || '',
    official: true,
    nutrients: extractCandidateNutrients(entry),
    perServing: true,
    servingAmount: servingDetails.amount,
    servingUnit: servingDetails.unit,
  };
}

function toLocalFoodCandidate(item) {
  return {
    id: `local-${item.name}`,
    kind: 'korean-food-db',
    name: item.name,
    grams: item.grams,
    category: item.category,
    brand: item.brand || '',
    sourceLabel: item.sourceLabel || '한식 칼로리 DB',
    sourceUrl: item.sourceUrl || '',
    official: Boolean(item.official),
    glycemicTag: item.glycemicTag,
    nutrients: extractCandidateNutrients(item),
  };
}

function normalizeRemoteCandidate(candidate) {
  if (!candidate?.name) return null;
  if (candidate.nutrients?.calories === '' || candidate.nutrients?.calories == null || !Number.isFinite(Number(candidate.nutrients.calories))) return null;
  const servingDetails = createServingDetails(candidate.serving, candidate.servingAmount, candidate.servingUnit);
  return {
    id: candidate.id || `server-${candidate.name}-${candidate.sourceUrl || ''}`,
    kind: candidate.kind || 'server-official-db',
    name: candidate.name,
    grams: candidate.perServing ? String(servingDetails.amount) : candidate.grams || '100',
    serving: candidate.serving || '',
    brand: candidate.brand || '',
    category: candidate.category || '공식 메뉴 DB',
    sourceLabel: candidate.sourceLabel || '공식 영양정보',
    sourceUrl: candidate.sourceUrl || '',
    imageUrl: candidate.imageUrl || '',
    official: Boolean(candidate.official),
    nutrients: extractCandidateNutrients(candidate.nutrients || {}),
    meta: candidate.meta || null,
    perServing: Boolean(candidate.perServing),
    servingAmount: servingDetails.amount,
    servingUnit: servingDetails.unit,
  };
}

function createServingDetails(label = '', explicitAmount = 0, explicitUnit = '') {
  const amount = Number(explicitAmount);
  if (Number.isFinite(amount) && amount > 0 && explicitUnit) {
    return { amount, unit: normalizeServingUnit(explicitUnit) };
  }

  const matches = [...String(label || '').matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|mL|l|L|개|잔|봉|팩|병|캔|컵|그릇|조각|인분|회)/gi)];
  const match = matches[matches.length - 1];
  if (!match) return { amount: 1, unit: '회' };
  return { amount: Number(match[1]) || 1, unit: normalizeServingUnit(match[2]) };
}

function normalizeServingUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  if (normalized === 'ml') return 'mL';
  if (normalized === 'l') return 'L';
  if (normalized === 'kg') return 'kg';
  if (normalized === 'g') return 'g';
  return unit || '회';
}

function formatServingAmount(amount, unit) {
  return `${formatCompactNumber(amount)} ${normalizeServingUnit(unit)}`;
}

function getServingInputStep(unit) {
  return ['개', '잔', '봉', '팩', '병', '캔', '컵', '그릇', '조각', '인분'].includes(unit) ? 0.5 : unit === '회' ? 0.25 : 1;
}

function getServingInputMax(amount, unit) {
  const basis = Math.max(Number(amount) || 1, 1);
  if (['g', 'mL'].includes(unit)) return Math.max(5000, basis * 20);
  if (['kg', 'L'].includes(unit)) return Math.max(20, basis * 20);
  return Math.max(100, basis * 20);
}

function calculateAppliedFoodCalories(food) {
  const calories = Number(food?.nutrients?.calories || 0);
  const consumedAmount = Number(food?.grams || 0);
  const basisAmount = Math.max(Number(food?.servingAmount || food?.nutrientBasisGrams || 1), 0.01);
  return Math.round((calories * consumedAmount * 10) / basisAmount) / 10;
}

function estimateTypicalKoreanMealCalories(food) {
  const name = normalizeLookupText(food?.name || '');
  if (!name || name.includes('직접검색')) return 0;

  const presets = [
    { keys: ['밥', 'rice'], grams: 210, kcalPer100g: 150 },
    { keys: ['찌개', '전골', 'stew'], grams: 250, kcalPer100g: 70 },
    { keys: ['국', '탕', 'soup'], grams: 250, kcalPer100g: 50 },
    { keys: ['김치', '깍두기'], grams: 40, kcalPer100g: 35 },
    { keys: ['계란', '달걀', 'egg'], grams: 60, kcalPer100g: 155 },
    { keys: ['고기', '불고기', '제육', '갈비', 'meat', 'pork', 'beef', 'chicken'], grams: 100, kcalPer100g: 220 },
    { keys: ['생선', '고등어', 'fish'], grams: 100, kcalPer100g: 180 },
    { keys: ['두부', 'tofu'], grams: 100, kcalPer100g: 90 },
    { keys: ['나물', '채소', '샐러드', 'vegetable', 'salad'], grams: 70, kcalPer100g: 70 },
    { keys: ['전', '튀김', 'fried'], grams: 80, kcalPer100g: 240 },
    { keys: ['반찬', 'side dish'], grams: 70, kcalPer100g: 120 },
  ];
  const preset = presets.find((item) => item.keys.some((key) => name.includes(normalizeLookupText(key))));
  const estimatedGrams = Math.max(Number(food?.grams || 0), 0) || preset?.grams || 70;
  const kcalPer100g = preset?.kcalPer100g || 120;
  return Math.round((estimatedGrams * kcalPer100g) / 100);
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
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          onChange={(event) => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 px-3 text-base outline-none"
          placeholder="0"
        />
        <span className="grid w-14 place-items-center bg-slate-100 text-xs text-slate-500">{unit}</span>
      </div>
    </label>
  );
}

function useSheetDialog(onClose) {
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const dialog = closeButtonRef.current?.closest('[role="dialog"]');
        const elements = Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]') || []).filter((element) => element.getClientRects().length && !element.closest('details:not([open]) > :not(summary)'));
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return closeButtonRef;
}

function DiarySheet({ profile, reports, onRefresh, onUpdate, onDelete, onRestore, onClose, onUpload, initialDay, notice = '' }) {
  const closeButtonRef = useSheetDialog(onClose);
  const [period, setPeriod] = useState('today');
  const [selectedDay, setSelectedDay] = useState(initialDay || dateKey());
  const [journal, setJournal] = useState(readJournal);
  const [diaryTab, setDiaryTab] = useState('records');
  const [editingMealId, setEditingMealId] = useState('');
  const [expandedMealId, setExpandedMealId] = useState('');
  const [deletedReport, setDeletedReport] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const stats = useMemo(() => diaryStats(reports, period, selectedDay), [reports, period, selectedDay]);
  const childMode = profile.mode === 'child';
  async function handleDelete(report) {
    if (!window.confirm('“' + (report.summary || '이 식사') + '” 기록을 지울까요?')) return;
    setBusy(true);
    try {
      const result = await onDelete(report.mealId);
      if (result.success) { setDeletedReport(result.report || report); setActionMessage('기록을 지웠어요. 되돌릴 수 있어요.'); setEditingMealId(''); }
      else setActionMessage('지우지 못했어요. 다시 해주세요.');
    } finally { setBusy(false); }
  }
  async function handleRestore() {
    if (!deletedReport) return;
    setBusy(true);
    try {
      const result = await onRestore(deletedReport);
      if (result.success) { setDeletedReport(null); setActionMessage('기록을 다시 넣었어요.'); }
      else setActionMessage('되돌리지 못했어요. 다시 해주세요.');
    } finally { setBusy(false); }
  }
  return <aside role="dialog" aria-modal="true" aria-labelledby="diary-title" className="meal-screen meal-diary"><div className="meal-page">
    <header className="meal-header"><button ref={closeButtonRef} type="button" className="meal-back" onClick={onClose}>← 사진 찍기</button><button type="button" className="meal-back" onClick={onRefresh}>새로고침</button></header>
    <div className="meal-page-title"><p>차곡차곡 쌓이는 나의 하루</p><h1 id="diary-title">나의 식사 기록</h1><p>무엇을 먹었는지 함께 살펴봐요.</p></div>
    {notice ? <p className="meal-success" role="status">✓ {notice}</p> : null}
    <div className="meal-period-tabs" role="group" aria-label="일기 메뉴">{[{ key: 'records', label: '달력·일기' }, { key: 'guide', label: '6대 영양소' }, { key: 'updates', label: '최신 자료' }].map((tab) => <button type="button" key={tab.key} aria-pressed={diaryTab === tab.key} onClick={() => setDiaryTab(tab.key)}>{tab.label}</button>)}</div>
    {diaryTab === 'updates' ? <NutritionUpdates /> : <>
    <DiaryCalendar selected={selectedDay} onSelect={(day) => { setSelectedDay(day); setPeriod('today'); }} reports={reports} journal={journal} />
    <div className="meal-period-tabs diary-period-options" role="group" aria-label="기록 기간">{[{ value: 'today', label: selectedDay === dateKey() ? '선택일 · 오늘' : '선택일' }, { value: 'week', label: '주간' }, { value: 'month', label: '월간' }, { value: '7d', label: '7일' }, { value: '30d', label: '30일' }].map((option) => <button type="button" key={option.value} aria-pressed={period === option.value} onClick={() => setPeriod(option.value)}>{option.label}</button>)}</div>
    <p className="meal-hint">{stats.label}{period === 'week' ? ' · 월요일~일요일' : ''}</p>
    {diaryTab === 'guide' ? <SixNutrientGuide totals={stats.totals} journal={journal[selectedDay]} period={period !== 'today'} hasMeals={stats.mealCount > 0} /> : <>
    <label className="meal-secondary diary-upload">＋ 하루 사진 한 번에 올리기<input type="file" accept="image/*" multiple className="sr-only" aria-label="하루 식사 사진 여러 장 고르기" onChange={onUpload} /></label>
    <section className="meal-card meal-total-card"><div className="meal-total-heading"><h2>{period === 'today' ? '선택한 날 먹은 식사' : '기록한 날의 하루 평균'}</h2><span className="meal-estimate">{stats.mealCount}끼 기록</span></div>
      <p className="meal-calorie-number">{Math.round(period === 'today' ? stats.totals.calories : stats.dailyAverage).toLocaleString('ko-KR')} <span>kcal</span></p>
      <MacroBar totals={stats.totals} />
      {stats.totals.missingNutrients?.length ? <p className="meal-hint">확인되지 않은 영양정보가 있어요. 합계는 확인된 값만 더했어요.</p> : null}
      {period === 'today' ? <DailyBudget goal={estimateDailyCalorieGoal(profile)} consumed={stats.totals.calories} childMode={childMode} /> : <><DiaryCalorieChart days={stats.chartDays} /><p className="meal-hint">{stats.periodDays}일 중 {stats.recordedDays}일 기록했어요. 기록한 날만 평균에 넣었어요.</p><div className="meal-stat-grid"><div><span>기간 전체</span><b>{Math.round(stats.totals.calories).toLocaleString('ko-KR')} kcal</b></div><div><span>한 끼 평균</span><b>{Math.round(stats.mealAverage).toLocaleString('ko-KR')} kcal</b></div></div></>}
    </section>
    {period !== 'today' ? <PeriodReview stats={stats} journal={journal} period={period} /> : null}
    <div className="meal-section-heading"><h2>{period === 'today' ? '선택한 날의 식사' : '먹은 식사 모아보기'}</h2><span>최근 기록부터</span></div>
    {stats.reports.length ? stats.reports.map((entry) => <article className="meal-card diary-meal-card" key={entry.mealId}>
      <button type="button" className="diary-meal-open" aria-expanded={expandedMealId === entry.mealId} onClick={() => setExpandedMealId(expandedMealId === entry.mealId ? '' : entry.mealId)}>
        {entry.imageUrl ? <img src={entry.imageUrl} alt={entry.summary || '식사 사진'} /> : <span className="diary-photo-placeholder" aria-hidden="true">🍽️</span>}
        <span className="diary-meal-description"><span className="diary-meal-type">{getMealTypeLabel(entry)} <small>{formatSavedReportDateTime(entry.createdAt)}</small></span><strong>{(entry.items || []).every((item) => item.isPendingInfo) ? '확인 필요' : '약 ' + Math.round(entry.totals?.calories || 0).toLocaleString('ko-KR')} <small>kcal</small></strong><span className="diary-meal-names">{entry.summary || '기록한 식사'}</span></span><span className="diary-chevron" aria-hidden="true">{expandedMealId === entry.mealId ? '−' : '+'}</span>
      </button>
      <MacroBar totals={entry.totals} compact />
      {(entry.items || []).some((item) => item.isPendingInfo) ? <p className="meal-hint">영양정보를 찾은 음식만 더했어요.</p> : null}
      {entry.userCorrected ? <p className="meal-hint">수정한 기록</p> : null}
      {expandedMealId === entry.mealId ? <div className="diary-meal-detail">
        {entry.imageUrl ? <MealPhoto src={entry.imageUrl} foods={(entry.items || []).map((item, index) => ({ ...item, id: 'saved-' + index, name: item.foodName }))} /> : null}
        <ul className="diary-food-list">{(entry.items || []).map((item, index) => <li key={index}><div><b>{item.foodName}</b><span>{formatCompactNumber(item.consumedAmount ?? item.servingSizeGrams ?? 0)}{item.servingUnit || 'g'}</span></div><strong>{item.isPendingInfo ? '확인 필요' : '약 ' + Math.round(item.nutrients?.calories || 0) + ' kcal'}</strong></li>)}</ul>
        {(entry.items || []).map((item, index) => <FoodEvidence key={index} item={{ ...item, name: item.foodName, grams: item.consumedAmount, serving: item.servingLabel }} />)}
        <div className="meal-stat-grid"><div><span>단백질</span><b>{formatCompactNumber(entry.totals?.protein || 0)}g</b></div><div><span>당류</span><b>{formatCompactNumber(entry.totals?.sugar || 0)}g</b></div><div><span>나트륨</span><b>{formatCompactNumber(entry.totals?.sodium || 0)}mg</b></div></div>
      </div> : null}
      {editingMealId === entry.mealId ? <DiaryEditForm report={entry} onCancel={() => setEditingMealId('')} onSave={async (changes) => { const result = await onUpdate(entry.mealId, changes); if (result.success) { setEditingMealId(''); setActionMessage('수정한 내용을 저장했어요.'); } return result; }} /> : <div className="diary-card-actions"><button type="button" onClick={() => setEditingMealId(entry.mealId)}>이름·양 고치기</button><button type="button" disabled={busy} onClick={() => handleDelete(entry)}>지우기</button></div>}
    </article>) : <div className="meal-card meal-empty"><span aria-hidden="true">🍽️</span><h2>{period === 'today' ? '오늘의 첫 식사를 남겨볼까요?' : '이 기간에는 기록이 없어요'}</h2><p>사진을 찍고 음식과 양을 확인하면 끝!</p><button type="button" className="meal-primary" onClick={onClose}>사진 찍으러 가기</button></div>}
    {period === 'today' ? <DailyJournal key={selectedDay} day={selectedDay} entry={journal[selectedDay]} onSaved={setJournal} /> : null}
    </>}
    <p className="meal-hint diary-storage-note">사진과 하루 일기는 이 기기에 보관해요. 브라우저 데이터를 지우면 기기 기록이 사라질 수 있어요.</p>
    </>}
    {actionMessage ? <div className="meal-toast" role="status"><span>{actionMessage}</span>{deletedReport ? <button type="button" disabled={busy} onClick={handleRestore}>되돌리기</button> : <button type="button" onClick={() => setActionMessage('')} aria-label="알림 닫기">닫기</button>}</div> : null}
  </div><div className="meal-bottom-bar"><button type="button" className="meal-primary" onClick={onClose}>＋ 새 식사 찍기</button></div></aside>;
}

function DiaryEditForm({ report, onSave, onCancel }) {
  const [mealType, setMealType] = useState(report.mealType || getMealTypeLabel(report));
  const [dateTime, setDateTime] = useState(toDateTimeLocalValue(report.createdAt));
  const [items, setItems] = useState(() => createEditableDiaryItems(report));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateItem(index, key, value) {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return { ...item, [key]: value, ...(key === 'consumedAmount' ? { calories: String(scaleHistoryItem(item.original, value).nutrients.calories || 0) } : {}) };
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanedItems = items.map((item) => {
      const scaled = scaleHistoryItem(item.original, item.consumedAmount);
      const renamed = item.foodName.trim() !== item.original.foodName;
      const manualCalories = Math.abs(Number(item.calories) - Number(scaled.nutrients.calories)) > .01;
      return { ...scaled, foodName: item.foodName.trim(), nameConfirmed: true, ...(renamed || manualCalories ? { sourceLabel: '사용자가 수정한 영양정보', sourceUrl: '', official: false, matched: false } : {}), nutrients: { ...scaled.nutrients, calories: Math.max(0, Number(item.calories || 0)) } };
    });
    if (cleanedItems.some((item) => !item.foodName)) {
      setError('음식명을 입력해 주세요.');
      return;
    }
    const parsedDate = new Date(dateTime);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate > new Date()) {
      setError('식사 날짜와 시간을 확인해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await onSave({ mealType, createdAt: parsedDate.toISOString(), items: cleanedItems });
      if (!result.success) setError(result.error?.message || '저장하지 못했어요. 다시 해주세요.');
    } catch { setError('저장하지 못했어요. 다시 해주세요.'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-2xl border-2 border-teal-200 bg-teal-50/60 p-3">
      <p className="text-sm font-black text-teal-800">기록 수정</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-black text-slate-600">
          식사 구분
          <select value={mealType} onChange={(event) => setMealType(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold">
            {['아침', '점심', '저녁', '간식·기타'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-xs font-black text-slate-600">
          날짜·시간
          <input type="datetime-local" value={dateTime} onChange={(event) => setDateTime(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-xs font-bold" />
        </label>
      </div>
      <div className="mt-3 grid gap-3">
        {items.map((item, index) => (
          <div key={`${index}-${item.original.foodName}`} className="rounded-xl bg-white p-3 shadow-sm">
            <label className="block text-xs font-black text-slate-600">
              음식명
              <input value={item.foodName} onChange={(event) => updateItem(index, 'foodName', event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold" />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs font-black text-slate-600">
                섭취량 ({item.original.servingUnit || 'g'})
                <input type="number" min="0" step="0.1" inputMode="decimal" value={item.consumedAmount} onChange={(event) => updateItem(index, 'consumedAmount', event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold" />
              </label>
              <label className="text-xs font-black text-slate-600">
                열량 (kcal)
                <input type="number" min="0" step="any" inputMode="decimal" value={item.calories} onChange={(event) => updateItem(index, 'calories', event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold" />
              </label>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm font-bold leading-relaxed text-slate-500">먹은 양을 바꾸면 칼로리와 영양소도 함께 바뀌어요. 저장하면 기록에 반영돼요.</p>
      {error ? <p role="alert" className="mt-2 text-sm font-black text-red-700">{error}</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="h-11 rounded-xl bg-white font-black text-slate-700">취소</button>
        <button type="submit" disabled={saving} className="h-11 rounded-xl bg-teal-600 font-black text-white disabled:opacity-50">{saving ? '저장 중…' : '수정 저장'}</button>
      </div>
    </form>
  );
}

function createEditableDiaryItems(report) {
  const reportItems = Array.isArray(report.items) && report.items.length
    ? report.items
    : [{
        foodName: report.summary || '식사',
        consumedAmount: 0,
        servingUnit: 'g',
        nutrients: {
          calories: report.totals?.calories || 0,
          carbohydrates: report.totals?.carb || 0,
          protein: report.totals?.protein || 0,
          fat: report.totals?.fat || 0,
          sodium: report.totals?.sodium || 0,
          sugar: report.totals?.sugar || 0,
        },
      }];
  return reportItems.map((item) => ({
    original: item,
    foodName: item.foodName || '',
    consumedAmount: String(item.consumedAmount ?? item.servingSizeGrams ?? item.servingCount ?? 0),
    calories: String(item.nutrients?.calories || 0),
  }));
}

function toDateTimeLocalValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function DiaryCalorieChart({ days }) {
  const maxCalories = Math.max(...days.map((day) => day.calories), 1);
  return (
    <div className="mt-5" aria-label="날짜별 열량 그래프">
      <div className="flex h-28 items-end gap-1 rounded-lg bg-slate-50 px-2 pt-3">
        {days.map((day) => {
          const height = day.calories ? Math.max(8, Math.round((day.calories / maxCalories) * 100)) : 2;
          return (
            <div key={day.key} className="flex min-w-0 flex-1 flex-col items-center justify-end self-stretch" title={`${day.label} ${Math.round(day.calories)}kcal`}>
              <span className={`w-full max-w-5 rounded-t ${day.calories ? 'bg-teal-500' : 'bg-slate-200'}`} style={{ height: `${height}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-black text-slate-400">
        <span>{days[0]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function createDiaryPeriodStats(reports, period) {
  const periodDays = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  const today = startOfLocalDay(new Date());
  const start = new Date(today);
  start.setDate(start.getDate() - (periodDays - 1));
  const filteredReports = reports
    .filter((report) => {
      const date = new Date(report.createdAt);
      return Number.isFinite(date.getTime()) && date >= start && date <= new Date();
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const totals = sumSavedReportTotals(filteredReports);
  const recordedDayKeys = new Set(filteredReports.map((report) => localDateKey(new Date(report.createdAt))));
  const mealCount = filteredReports.length;
  const recordedDays = recordedDayKeys.size;
  const chartDays = Array.from({ length: periodDays }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateKey(date);
    const calories = filteredReports
      .filter((report) => localDateKey(new Date(report.createdAt)) === key)
      .reduce((total, report) => total + Number(report.totals?.calories || 0), 0);
    return { key, label: `${date.getMonth() + 1}/${date.getDate()}`, calories };
  });

  return {
    reports: filteredReports,
    totals,
    periodDays,
    recordedDays,
    mealCount,
    mealAverage: mealCount ? totals.calories / mealCount : 0,
    dailyAverage: recordedDays ? totals.calories / recordedDays : 0,
    chartDays,
  };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getMealTypeLabel(report) {
  if (report.mealType) return report.mealType;
  const hour = new Date(report.createdAt).getHours();
  if (hour >= 5 && hour < 11) return '아침';
  if (hour >= 11 && hour < 16) return '점심';
  if (hour >= 16 && hour < 22) return '저녁';
  return '간식·기타';
}

function formatSavedReportDateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function SettingsSheet({ profile, updateProfile, toggleMedical, onClose }) {
  const [guideOpen, setGuideOpen] = useState(false);
  const closeButtonRef = useSheetDialog(onClose);

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur"
    >
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-slate-50 p-5 text-slate-950 shadow-2xl md:left-auto md:right-6 md:top-6 md:w-[520px] md:rounded-2xl">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-teal-700">카메라 분석 설정</p>
            <h2 id="settings-title" className="text-3xl font-black">설정</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="h-11 rounded-full bg-slate-950 px-5 font-black text-white">
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
                aria-pressed={profile.mode === option.id}
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
                aria-pressed={profile.medical.includes(option)}
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
                aria-pressed={profile.sport === option.id}
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
            입력부터 기록 확인까지 3단계면 끝납니다.
          </span>
        </span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-950 text-xl font-black text-white">
          {open ? '−' : '+'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm font-bold leading-relaxed text-slate-800">
          <div className="grid gap-3">
            <GuideStep number="1" title="촬영 또는 음성으로 입력">
              빨간 촬영 버튼을 누르거나, 마이크 버튼을 눌러 “돼지국밥 한 그릇”처럼 말합니다.
            </GuideStep>
            <GuideStep number="2" title="음식명·양·kcal 확인">
              맞으면 그대로 진행하고, 다르면 음식명이나 양만 수정합니다. 사진 분석이 느리면 `직접 DB 검색`을 누릅니다.
            </GuideStep>
            <GuideStep number="3" title="이 식사 기록하기">
              화면 아래의 큰 버튼을 한 번 누르면 저장되고 오늘 기록이 자동으로 열립니다.
            </GuideStep>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white p-3">
              <p className="text-xs font-black text-teal-700">기록 확인</p>
              <p className="mt-1 text-xs text-slate-600">첫 화면의 `기록`에서 오늘·최근 7일·최근 30일 통계를 봅니다. 잘못된 기록은 카드의 `수정` 또는 `삭제`를 누릅니다.</p>
            </div>
            <div className="rounded-lg bg-white p-3">
              <p className="text-xs font-black text-teal-700">정확도 높이기</p>
              <p className="mt-1 text-xs text-slate-600">자동 인식된 음식명과 섭취량을 저장 전에 한 번 확인합니다.</p>
            </div>
          </div>

          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            처음 음성을 사용할 때는 마이크 권한을 허용해주세요. 촬영 결과가 불확실할 때만 DB 후보 확인 화면이 나타납니다. 수정 전 최초 분석값은 보존됩니다.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function GuideStep({ number, title, children }) {
  return (
    <div className="flex gap-3 rounded-lg bg-white p-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-sm font-black text-white">{number}</span>
      <div>
        <strong className="block text-sm font-black text-slate-950">{title}</strong>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{children}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-100 p-3">
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
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
  return Boolean(item && !item.isPendingInfo && !item.missingNutrients?.includes('calories') && Number.isFinite(Number(item.calories)) && Number(item.calories) >= 0);
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
      return normalizeStoredProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'));
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  function setProfile(updater) {
    setProfileState((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      const normalized = normalizeStoredProfile(next);
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
      } catch {
        // Storage can be unavailable in private browsing; keep the in-memory profile usable.
      }
      return normalized;
    });
  }

  return [profile, setProfile];
}

function normalizeStoredProfile(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mode = modeOptions.some((option) => option.id === source.mode) ? source.mode : DEFAULT_PROFILE.mode;
  const gender = ['남성', '여성'].includes(source.gender) ? source.gender : DEFAULT_PROFILE.gender;
  const sport = sportOptions.some((option) => option.id === source.sport) ? source.sport : DEFAULT_PROFILE.sport;
  const medical = Array.isArray(source.medical)
    ? source.medical.filter((item) => medicalOptions.includes(item))
    : DEFAULT_PROFILE.medical;
  return {
    mode,
    age: clampNumber(Number(source.age) || DEFAULT_PROFILE.age, 6, 90),
    gender,
    height: clampNumber(Number(source.height) || DEFAULT_PROFILE.height, 110, 210),
    weight: clampNumber(Number(source.weight) || DEFAULT_PROFILE.weight, 20, 150),
    medical: medical.length ? medical : ['없음'],
    sport,
  };
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

function drawVideoFrame(canvas, video, maxWidth = 0) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = maxWidth ? Math.min(1, maxWidth / sourceWidth) : 1;

  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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

async function readNutritionTextFastFromImage(photo) {
  if (!photo || !('TextDetector' in window)) return { status: 'manual', text: '' };
  try {
    const image = await loadImage(photo);
    const detector = new window.TextDetector();
    const candidates = createOcrCandidateCanvases(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    ).slice(0, 2);
    const text = await detectBestText(detector, candidates);
    return { status: text ? 'text-detected' : 'manual', text };
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

async function readTextWithTesseract(photo, candidates = []) {
  try {
    const { default: Tesseract } = await import('tesseract.js');
    const ocrTargets = candidates.length ? candidates.slice(0, 2).filter(Boolean) : [photo];
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

function resolveWithin(promise, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

async function fetchWithTimeout(input, options = {}, timeoutMs = NETWORK_SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function recognizeFoodsWithVision(photo) {
  try {
    const image = await prepareVisionImage(photo);
    const response = await fetchWithTimeout('/api/vision-analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image }),
    }, CAPTURE_VISION_TIMEOUT_MS);
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429 || result?.code === 'ai_free_quota_exceeded') showAiQuotaWarning();
      return [];
    }

    const recognitions = (Array.isArray(result?.foods) ? result.foods : []).filter(
      (recognition) => recognition?.name && Number(recognition.confidence || 0) >= 0.55,
    );
    return await Promise.all(recognitions.map((recognition) => createVisionFoodItem(recognition, result?.provider)));
  } catch (error) {
    console.warn('Vision recognition unavailable', error);
    return [];
  }
}

function showAiQuotaWarning() {
  if (aiQuotaWarningShown) return;
  aiQuotaWarningShown = true;
  window.alert(AI_QUOTA_WARNING_MESSAGE);
}

async function createVisionFoodItem(recognition, provider) {
  const normalizedName = normalizeLookupText(recognition.name);
  const localCandidates = createNutritionSearchCandidates(recognition.name);
  const exactLocalCandidates = localCandidates.filter((item) => normalizeLookupText(item.name) === normalizedName);
  const trustedLocalCandidate = exactLocalCandidates[0];
  const query = [recognition.brand, recognition.name].filter(Boolean).join(' ');
  let remoteCandidates = [];
  if (!trustedLocalCandidate) {
    remoteCandidates = await searchNutritionCandidatesCached(query);
    if (!remoteCandidates.length && recognition.brand) {
      remoteCandidates = await searchNutritionCandidatesCached(recognition.name);
    }
  }
  const candidates = uniqueCandidates([
    ...(trustedLocalCandidate ? [trustedLocalCandidate] : []),
    ...exactLocalCandidates,
    ...remoteCandidates,
    ...localCandidates.filter((item) => item !== trustedLocalCandidate && !exactLocalCandidates.includes(item)),
  ]);
  const candidate = candidates.find((item) => sameFoodName(item.name, recognition.name));
  const grams = String(Number(recognition.estimatedGrams) || Number(candidate?.grams) || 100);
  return {
    ...createEmptyFoodItem(),
    name: candidate?.name || recognition.name,
    englishName: recognition.englishName || '',
    recognizedName: candidate?.name || recognition.name,
    position: normalizeFoodPosition(recognition.position),
    grams,
    estimated: true,
    requiresConfirmation: true,
    nameConfirmed: false,
    portionSource: Number(recognition.estimatedGrams) > 0 ? 'photo' : 'standard',
    portionConfirmed: false,
    visualReason: '사진에서 찾은 후보예요. 음식 이름과 먹은 양을 확인해 주세요.',
    confidenceScore: Number(recognition.confidence),
    recognitionSource: provider || 'ai-vision',
    quantity: Number(recognition.quantity || 0) || '',
    unitLabel: recognition.unitLabel || (Number(recognition.quantity || 0) ? '개' : ''),
    foodType: recognition.foodType || '',
    nutrients: candidate?.nutrients || null,
    nutrientBasisGrams: candidate?.grams || grams,
    brand: candidate?.brand || recognition.brand || '',
    category: candidate?.category || '',
    serving: candidate?.serving || '',
    sourceLabel: candidate?.sourceLabel || '',
    sourceUrl: candidate?.sourceUrl || '',
    imageUrl: candidate?.imageUrl || '',
    nutritionCandidates: candidates,
  };
}

async function createFoodReferenceGroups(foods, { includeImages = false } = {}) {
  return Promise.all(
    foods.slice(0, 8).map(async (food, index) => {
      if (food.recognitionSource === 'manual-review' || normalizeLookupText(food.name).includes('직접검색')) {
        return {
          id: `reference-${food.id || index}-manual`,
          detectedFood: food,
          candidates: [],
          images: [],
        };
      }
      const query = [food.brand, food.name].filter(Boolean).join(' ');
      const remoteRows = Array.isArray(food.nutritionCandidates) && food.nutritionCandidates.length
        ? food.nutritionCandidates
        : await searchNutritionCandidatesCached(query || food.name);
      const remoteCandidates = remoteRows.map(normalizeRemoteCandidate).filter(Boolean);
      const localCandidates = createNutritionSearchCandidates(food.name);
      const normalizedDetectedName = normalizeLookupText(food.name);
      const exactLocalCandidates = localCandidates.filter((candidate) => normalizeLookupText(candidate.name) === normalizedDetectedName);
      const detectedCandidate = {
        id: `detected-${food.id || index}-${normalizeLookupText(food.name)}`,
        kind: 'detected-food',
        name: food.name,
        grams: food.grams || '100',
        brand: food.brand || '',
        category: food.category || 'AI 촬영 인식',
        sourceLabel: food.sourceLabel || 'AI 촬영 인식 후보',
        sourceUrl: food.sourceUrl || '',
        imageUrl: food.imageUrl || '',
        official: Boolean(food.official),
        nutrients: food.nutrients || null,
        perServing: Boolean(food.perServing),
        serving: food.serving || '',
        servingAmount: food.servingAmount || 0,
        servingUnit: food.servingUnit || 'g',
      };
      const candidates = uniqueCandidates([
        ...exactLocalCandidates,
        ...remoteCandidates,
        ...localCandidates.filter((candidate) => !exactLocalCandidates.includes(candidate)),
        detectedCandidate,
      ]).slice(0, 6);
      const officialImages = candidates
        .filter((candidate) => candidate.imageUrl)
        .map((candidate) => ({
          id: `official-${candidate.id}`,
          title: candidate.name,
          thumbnailUrl: candidate.imageUrl,
          sourceUrl: candidate.sourceUrl || candidate.imageUrl,
          creator: candidate.brand || '공식 제품 이미지',
          license: '공식 페이지',
          provider: candidate.sourceLabel || '공식 영양 DB',
        }));
      const searchedImages = includeImages && index < 4 ? await searchFoodReferenceImages(food.englishName || food.name) : [];
      const images = uniqueReferenceImages([...officialImages, ...searchedImages]).slice(0, 4);

      return {
        id: `reference-${food.id || index}-${normalizeLookupText(food.name)}`,
        detectedFood: food,
        candidates,
        images,
      };
    }),
  );
}

async function searchFoodReferenceImages(query) {
  if (!String(query || '').trim()) return [];
  try {
    const response = await fetchWithTimeout(`/api/food-image-search?q=${encodeURIComponent(query)}&limit=4`, {}, NETWORK_SEARCH_TIMEOUT_MS);
    const payload = response.ok ? await response.json() : null;
    return Array.isArray(payload?.images) ? payload.images : [];
  } catch {
    return [];
  }
}

function uniqueReferenceImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    const key = image.thumbnailUrl || image.sourceUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createConfirmedFoodItem(candidate, detectedFood) {
  if (!candidate?.name) return null;
  const servingDetails = createServingDetails(candidate.serving, candidate.servingAmount, candidate.servingUnit);
  const grams = String(detectedFood?.grams || (candidate.perServing ? servingDetails.amount : candidate.grams) || 100);
  return {
    ...createEmptyFoodItem(),
    name: candidate.name,
    recognizedName: detectedFood?.name || candidate.name,
    position: normalizeFoodPosition(detectedFood?.position),
    grams,
    estimated: false,
    requiresConfirmation: false,
    visualReason: '음식 이름을 사용자가 확인함',
    nameConfirmed: true,
    portionSource: detectedFood?.portionSource || 'unknown',
    portionConfirmed: Boolean(detectedFood?.portionConfirmed),
    portionChoice: detectedFood?.portionChoice || '',
    confidenceScore: Number(detectedFood?.confidenceScore || 0),
    recognitionSource: 'visual-reference-confirmed',
    quantity: detectedFood?.quantity || '',
    unitLabel: detectedFood?.unitLabel || '',
    foodType: detectedFood?.foodType || '',
    nutrients: candidate.nutrients || null,
    nutrientBasisGrams: candidate.perServing ? String(servingDetails.amount) : candidate.grams || grams,
    brand: candidate.brand || '',
    category: candidate.category || '',
    serving: candidate.serving || '',
    sourceLabel: candidate.sourceLabel || '',
    sourceUrl: candidate.sourceUrl || '',
    official: Boolean(candidate.official),
    perServing: Boolean(candidate.perServing),
    servingAmount: candidate.perServing ? servingDetails.amount : 0,
    servingUnit: candidate.perServing ? servingDetails.unit : 'g',
  };
}

async function searchNutritionCandidatesCached(query) {
  const key = normalizeLookupText(query);
  const cached = nutritionSearchCache.get(key);
  if (cached && Date.now() - cached.createdAt < NUTRITION_SEARCH_CACHE_TTL_MS) return cached.candidates;
  const stored = readStoredNutritionSearch(key);
  if (stored) {
    nutritionSearchCache.set(key, stored);
    return stored.candidates;
  }

  try {
    const response = await fetchWithTimeout(`/api/nutrition-search?q=${encodeURIComponent(query)}&limit=8`, {}, NETWORK_SEARCH_TIMEOUT_MS);
    const result = response.ok ? await response.json() : null;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const entry = { createdAt: Date.now(), candidates };
    nutritionSearchCache.set(key, entry);
    if (candidates.length) writeStoredNutritionSearch(key, entry);
    return candidates;
  } catch {
    return [];
  }
}

function readStoredNutritionSearch(key) {
  try {
    const cache = JSON.parse(localStorage.getItem(NUTRITION_SEARCH_STORAGE_KEY) || '{}');
    const entry = cache?.[key];
    if (!entry || Date.now() - Number(entry.createdAt || 0) >= NUTRITION_SEARCH_CACHE_TTL_MS) return null;
    return { createdAt: Number(entry.createdAt), candidates: Array.isArray(entry.candidates) ? entry.candidates : [] };
  } catch {
    return null;
  }
}

function writeStoredNutritionSearch(key, entry) {
  try {
    const cache = JSON.parse(localStorage.getItem(NUTRITION_SEARCH_STORAGE_KEY) || '{}');
    cache[key] = entry;
    const recentEntries = Object.entries(cache)
      .filter(([, value]) => Date.now() - Number(value?.createdAt || 0) < NUTRITION_SEARCH_CACHE_TTL_MS)
      .sort(([, left], [, right]) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, 60);
    localStorage.setItem(NUTRITION_SEARCH_STORAGE_KEY, JSON.stringify(Object.fromEntries(recentEntries)));
  } catch {
    // 저장 공간이 부족해도 현재 검색 결과는 메모리 캐시에서 계속 사용합니다.
  }
}

function isTrustedLocalRecognition(food, facts) {
  if (hasReadableNutritionFacts(facts) && String(facts?.foodName || '').trim()) return true;
  if (!food) return false;
  const score = Number(food.confidenceScore || 0);
  const source = String(food.recognitionSource || '');
  return score >= 0.92 && (source.includes('official') || source.includes('ocr-text'));
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

async function cropPhotoAroundPoint(photo, xRatio, yRatio) {
  const image = await loadImage(photo);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.max(1, Math.round(Math.min(sourceWidth, sourceHeight) * 0.52));
  const centerX = Math.min(sourceWidth, Math.max(0, Number(xRatio || 0.5) * sourceWidth));
  const centerY = Math.min(sourceHeight, Math.max(0, Number(yRatio || 0.5) * sourceHeight));
  const sourceX = Math.min(sourceWidth - cropSize, Math.max(0, Math.round(centerX - cropSize / 2)));
  const sourceY = Math.min(sourceHeight - cropSize, Math.max(0, Math.round(centerY - cropSize / 2)));
  const outputSize = Math.min(768, cropSize);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  canvas.getContext('2d', { alpha: false }).drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    outputSize,
    outputSize,
  );
  return { photo: canvas.toDataURL('image/jpeg', 0.8), x: sourceX / sourceWidth, y: sourceY / sourceHeight, width: cropSize / sourceWidth, height: cropSize / sourceHeight };
}

async function prepareRecognitionFeedbackImage(photo) {
  const image = await loadImage(photo);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.max(1, Math.round(Math.min(sourceWidth, sourceHeight) * 0.82));
  const sourceX = Math.max(0, Math.round((sourceWidth - cropSize) / 2));
  const sourceY = Math.max(0, Math.round((sourceHeight - cropSize) / 2));
  const outputSize = Math.min(640, cropSize);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  canvas.getContext('2d', { alpha: false }).drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    outputSize,
    outputSize,
  );
  return canvas.toDataURL('image/jpeg', 0.68);
}

async function saveRecognitionFeedback(captured, selections) {
  if (!captured?.photo || !Array.isArray(selections) || !selections.length) return;
  const image = await prepareRecognitionFeedbackImage(captured.photo);
  const selectedNames = selections.map(({ candidate }) => String(candidate?.name || '').trim()).filter(Boolean);
  const detectedFoods = selections.map(({ detectedFood }) => detectedFood).filter(Boolean);
  const primary = selections[0]?.candidate || {};
  const candidateNames = [...new Set((captured.referenceGroups || [])
    .flatMap((group) => (group.candidates || []).map((candidate) => candidate?.name))
    .filter(Boolean))].slice(0, 8);
  const confidenceValues = detectedFoods.map((food) => Number(food?.confidenceScore || 0)).filter(Number.isFinite);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;

  const response = await fetch('/api/recognition-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      image,
      detectedName: detectedFoods.map((food) => food?.name).filter(Boolean).join(', '),
      confirmedName: selectedNames.join(', '),
      sourceLabel: primary.sourceLabel || '',
      sourceUrl: primary.sourceUrl || '',
      official: selections.every(({ candidate }) => Boolean(candidate?.official)),
      confidence,
      recognitionSource: detectedFoods.map((food) => food?.recognitionSource).filter(Boolean).join(', '),
      candidateNames: candidateNames.length ? candidateNames : selectedNames,
    }),
  });
  if (!response.ok) throw new Error(`Feedback upload failed (${response.status})`);
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

  const hint = textFoodEstimates.find((entry) => entry.keys.some((key) => sameFoodName(text, key)));
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
    recognizedName: name,
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

function waitForCameraFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 45));
  });
}

async function scoreCapturedPhotoQuality(photo) {
  const image = await loadImage(photo);
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = Math.max(80, Math.round((120 * (image.naturalHeight || image.height)) / Math.max(image.naturalWidth || image.width, 1)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Float32Array(canvas.width * canvas.height);
  let brightnessTotal = 0;

  for (let pixel = 0, offset = 0; offset < data.length; pixel += 1, offset += 4) {
    const value = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    luminance[pixel] = value;
    brightnessTotal += value;
  }

  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < canvas.height; y += 2) {
    for (let x = 1; x < canvas.width; x += 2) {
      const index = y * canvas.width + x;
      edgeTotal += Math.abs(luminance[index] - luminance[index - 1]);
      edgeTotal += Math.abs(luminance[index] - luminance[index - canvas.width]);
      edgeCount += 2;
    }
  }

  const averageBrightness = brightnessTotal / Math.max(luminance.length, 1);
  const exposurePenalty = averageBrightness < 45 ? 45 - averageBrightness : averageBrightness > 220 ? averageBrightness - 220 : 0;
  return edgeTotal / Math.max(edgeCount, 1) - exposurePenalty * 0.4;
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
  if (status === 'voice-input') return '음성으로 입력한 식사입니다. 제품 영양표가 있다면 아래에서 검색하거나 사진을 추가할 수 있습니다.';
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
      acc.missingNutrients = [...new Set([...acc.missingNutrients, ...(totals.missingNutrients || []), ...(report.items?.some((item) => item.isPendingInfo) ? ['calories', 'carb', 'protein', 'fat'] : [])])];
      acc.calories += Number(totals.calories || 0);
      acc.carb += Number(totals.carb || 0);
      acc.protein += Number(totals.protein || 0);
      acc.fat += Number(totals.fat || 0);
      acc.sodium += Number(totals.sodium || 0);
      acc.sugar += Number(totals.sugar || 0);
      return acc;
    },
    { calories: 0, carb: 0, protein: 0, fat: 0, sodium: 0, sugar: 0, missingNutrients: [] },
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
  if (value == null || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
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
