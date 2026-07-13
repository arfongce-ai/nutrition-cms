import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db, firebaseEnabled } from '../firebase';

const LOCAL_REPORTS_KEY = 'nutritionReports.v1';
const MEALS_COLLECTION = 'meals_history';

export async function saveNutritionReport(report, options = {}) {
  const payload = buildMealHistoryPayload(report, options.imageUrl || '');

  saveLocalReport(payload);

  if (!firebaseEnabled || !db) {
    return { storage: 'local', status: payload.status, mealId: payload.mealId };
  }

  try {
    if (auth && !auth.currentUser) {
      await signInAnonymously(auth);
    }
    const { imageUrl, ...cloudPayload } = payload;
    await setDoc(doc(db, MEALS_COLLECTION, payload.mealId), {
      ...cloudPayload,
      imageUrl: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      uid: auth?.currentUser?.uid || null,
    });
    return { storage: 'firebase', status: payload.status, mealId: payload.mealId };
  } catch (error) {
    console.warn('[reportStore] Firebase save failed, local report kept.', error);
    return { storage: 'local', status: payload.status, mealId: payload.mealId, error };
  }
}

export async function updatePendingMealIngredients(mealId, verifiedNutrients, itemIndex = 0) {
  const localResult = updateLocalPendingMeal(mealId, verifiedNutrients, itemIndex);

  if (!firebaseEnabled || !db) {
    return localResult;
  }

  try {
    if (auth && !auth.currentUser) {
      await signInAnonymously(auth);
    }

    const mealRef = doc(db, MEALS_COLLECTION, mealId);
    const snapshot = await getDoc(mealRef);

    if (!snapshot.exists()) {
      throw new Error('저장된 식단 기록을 찾을 수 없습니다.');
    }

    const current = snapshot.data();
    const items = Array.isArray(current.items) ? current.items : [];
    const nextItems = updateHistoryItems(items, verifiedNutrients, itemIndex);
    const nextStatus = nextItems.some((item) => item.isPendingInfo) ? 'PENDING' : 'COMPLETED';

    await updateDoc(mealRef, {
      items: nextItems,
      status: nextStatus,
      totals: sumHistoryItems(nextItems),
      updatedAt: serverTimestamp(),
    });

    return { success: true, storage: 'firebase', status: nextStatus };
  } catch (error) {
    console.warn('[reportStore] Firebase pending update failed.', error);
    return { ...localResult, error };
  }
}

function buildMealHistoryPayload(report, imageUrl = '') {
  const items = report.items.map(toMealHistoryItem);
  const hasPendingInfo = items.some((item) => item.isPendingInfo);
  const createdAt = new Date().toISOString();

  return {
    userId: 'anonymous',
    mealId: `meal_${createdAt.replace(/\D/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    updatedAt: createdAt,
    imageUrl,
    status: hasPendingInfo ? 'PENDING' : 'COMPLETED',
    analysisType: report.analysisType,
    mode: report.profile.mode,
    stamp: report.stamp,
    summary: report.items.map((item) => item.name).join(', '),
    message: report.messageText,
    profile: report.profile,
    foods: report.foods,
    facts: report.facts,
    items,
    totals: report.totals,
    macroPercent: report.macroPercent,
    dietScore: report.dietScore,
    glycemic: report.glycemic,
    risk: report.risk,
    sourceItems: report.sourceItems,
    pendingItems: items.filter((item) => item.isPendingInfo).map((item) => item.foodName),
  };
}

function toMealHistoryItem(item) {
  const pending = Boolean(item.isPendingInfo);

  return {
    foodName: item.name,
    isPendingInfo: pending,
    servingSizeGrams: Number(item.grams || 0),
    nutrients: pending ? createZeroNutrients() : normalizeNutrients(item),
    sourceLabel: item.sourceLabel || '',
    sourceUrl: item.sourceUrl || '',
    brand: item.brand || '',
    category: item.category || '',
    quantity: Number(item.quantity || 0) || 0,
    unitLabel: item.unitLabel || '',
    foodType: item.foodType || '',
  };
}

function normalizeNutrients(source = {}) {
  return {
    calories: Number(source.calories || 0),
    carbohydrates: Number(source.carbohydrates ?? source.carb ?? 0),
    protein: Number(source.protein || 0),
    fat: Number(source.fat || 0),
    sodium: Number(source.sodium || 0),
    sugar: Number(source.sugar || 0),
    saturatedFat: Number(source.saturatedFat || 0),
    transFat: Number(source.transFat || 0),
  };
}

function createZeroNutrients() {
  return {
    calories: 0,
    carbohydrates: 0,
    protein: 0,
    fat: 0,
    sodium: 0,
    sugar: 0,
    saturatedFat: 0,
    transFat: 0,
  };
}

function updateHistoryItems(items, verifiedNutrients, itemIndex) {
  return items.map((item, index) => {
    if (index !== itemIndex) return item;
    return {
      ...item,
      isPendingInfo: false,
      nutrients: normalizeNutrients(verifiedNutrients),
    };
  });
}

function updateLocalPendingMeal(mealId, verifiedNutrients, itemIndex) {
  const reports = readLocalReports();
  const index = reports.findIndex((report) => report.mealId === mealId);

  if (index < 0) {
    return { success: false, storage: 'local', error: new Error('저장된 식단 기록을 찾을 수 없습니다.') };
  }

  const items = updateHistoryItems(reports[index].items || [], verifiedNutrients, itemIndex);
  const status = items.some((item) => item.isPendingInfo) ? 'PENDING' : 'COMPLETED';
  reports[index] = {
    ...reports[index],
    items,
    status,
    totals: sumHistoryItems(items),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports.slice(0, 50)));

  return { success: true, storage: 'local', status };
}

function sumHistoryItems(items) {
  return items.reduce(
    (acc, item) => {
      const nutrients = item.nutrients || {};
      acc.calories += Number(nutrients.calories || 0);
      acc.carb += Number(nutrients.carbohydrates || 0);
      acc.protein += Number(nutrients.protein || 0);
      acc.fat += Number(nutrients.fat || 0);
      acc.sodium += Number(nutrients.sodium || 0);
      acc.sugar += Number(nutrients.sugar || 0);
      return acc;
    },
    { calories: 0, carb: 0, protein: 0, fat: 0, sodium: 0, sugar: 0 },
  );
}

function saveLocalReport(payload) {
  const reports = readLocalReports();
  reports.unshift(payload);
  const limitedReports = reports.slice(0, 50);
  if (tryWriteLocalReports(limitedReports)) return;

  const keepRecentPhotos = limitedReports.map((report, index) => (index < 8 ? report : { ...report, imageUrl: '' }));
  if (tryWriteLocalReports(keepRecentPhotos)) return;

  const newestPhotoOnly = limitedReports.map((report, index) => (index === 0 ? report : { ...report, imageUrl: '' }));
  if (tryWriteLocalReports(newestPhotoOnly)) return;

  tryWriteLocalReports(limitedReports.map((report) => ({ ...report, imageUrl: '' })));
}

function tryWriteLocalReports(reports) {
  try {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports));
    return true;
  } catch (error) {
    console.warn('[reportStore] Local photo storage limit reached.', error);
    return false;
  }
}

export function readLocalReports() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
