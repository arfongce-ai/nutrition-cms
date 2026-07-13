const LEARNING_EVENTS_KEY = 'nutritionRecognitionLearning.v1';
const MAX_LEARNING_EVENTS = 300;

export function recordRecognitionObservation(foods = []) {
  const events = foods
    .filter((food) => String(food?.name || '').trim())
    .map((food) => ({
      type: 'observation',
      createdAt: new Date().toISOString(),
      foodId: food.id || '',
      recognizedName: String(food.name || '').trim(),
      confidenceScore: Number(food.confidenceScore || 0),
      recognitionSource: food.recognitionSource || '',
      quantity: Number(food.quantity || 0),
      unitLabel: food.unitLabel || '',
      grams: Number(food.grams || 0),
      hadOfficialNutrients: Boolean(food.nutrients),
    }));
  appendLearningEvents(events);
}

export function recordRecognitionCorrection(food, nextName) {
  const recognizedName = String(food?.name || '').trim();
  const correctedName = String(nextName || '').trim();
  if (!recognizedName || !correctedName || normalize(recognizedName) === normalize(correctedName)) return;

  appendLearningEvents([{
    type: 'correction',
    createdAt: new Date().toISOString(),
    foodId: food.id || '',
    recognizedName,
    correctedName,
    confidenceScore: Number(food.confidenceScore || 0),
    recognitionSource: food.recognitionSource || '',
    originalGrams: Number(food.grams || 0),
  }]);
}

export function readRecognitionLearningSummary() {
  const events = readLearningEvents();
  const observations = events.filter((event) => event.type === 'observation');
  const corrections = events.filter((event) => event.type === 'correction');
  return {
    events: events.length,
    observations: observations.length,
    corrections: corrections.length,
    correctionRate: observations.length ? Math.round((corrections.length / observations.length) * 100) : 0,
  };
}

function appendLearningEvents(nextEvents) {
  if (!nextEvents.length) return;
  try {
    const events = [...nextEvents, ...readLearningEvents()].slice(0, MAX_LEARNING_EVENTS);
    localStorage.setItem(LEARNING_EVENTS_KEY, JSON.stringify(events));
  } catch (error) {
    console.warn('[recognitionLearning] Local learning event save failed.', error);
  }
}

function readLearningEvents() {
  try {
    const events = JSON.parse(localStorage.getItem(LEARNING_EVENTS_KEY) || '[]');
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}
