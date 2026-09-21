import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db, firebaseEnabled } from '../firebase';
import { getMacroBreakdown } from './mealPresentation';

const LOCAL_REPORTS_KEY = 'nutritionReports.v1';
const MEALS_COLLECTION = 'meals_history';

export async function saveNutritionReport(report, options = {}) {
  if (options.createdAt && (!Number.isFinite(new Date(options.createdAt).getTime()) || new Date(options.createdAt) > new Date())) return { saved: false, error: new Error('식사 날짜와 시간을 확인해 주세요.') };
  const payload = buildMealHistoryPayload(report, options.imageUrl || '', options.createdAt);
  if (['아침', '점심', '저녁', '간식·기타'].includes(options.mealType)) payload.mealType = options.mealType;

  const localSaved = saveLocalReport(payload);
  if (!localSaved) return { storage: 'local', saved: false, mealId: payload.mealId };

  if (!firebaseEnabled || !db) {
    return { storage: 'local', status: payload.status, mealId: payload.mealId, saved: localSaved };
  }

  try {
    if (auth && !auth.currentUser) {
      await signInAnonymously(auth);
    }
    const { imageUrl, ...cloudPayload } = payload;
    await setDoc(doc(db, MEALS_COLLECTION, payload.mealId), {
      ...cloudPayload,
      imageUrl: '',
      createdAt: new Date(payload.createdAt),
      recordedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      uid: auth?.currentUser?.uid || null,
    });
    return { storage: 'firebase', status: payload.status, mealId: payload.mealId, saved: true, localSaved };
  } catch (error) {
    console.warn('[reportStore] Firebase save failed, local report kept.', error);
    return { storage: 'local', status: payload.status, mealId: payload.mealId, saved: localSaved, error };
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

export async function updateNutritionReport(mealId, changes) {
  const localResult = updateLocalNutritionReport(mealId, changes);
  if (!localResult.success || !firebaseEnabled || !db) return localResult;

  try {
    if (auth && !auth.currentUser) await signInAnonymously(auth);
    const report = localResult.report;
    await updateDoc(doc(db, MEALS_COLLECTION, mealId), {
      createdAt: new Date(report.createdAt),
      mealType: report.mealType,
      summary: report.summary,
      items: report.items,
      totals: report.totals,
      macroPercent: getMacroBreakdown(report.totals),
      originalAnalysis: report.originalAnalysis,
      userCorrected: true,
      correctedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { ...localResult, storage: 'firebase' };
  } catch (error) {
    console.warn('[reportStore] Firebase report update failed, local correction kept.', error);
    return { ...localResult, storage: 'local', error };
  }
}

export async function deleteNutritionReport(mealId) {
  const reports = readLocalReports();
  const report = reports.find((item) => item.mealId === mealId);
  if (!report) return { success: false, error: new Error('삭제할 기록을 찾을 수 없습니다.') };
  const localSaved = tryWriteLocalReports(reports.filter((item) => item.mealId !== mealId));
  if (!localSaved) return { success: false, error: new Error('기기 기록을 삭제하지 못했습니다.') };

  if (!firebaseEnabled || !db) return { success: true, storage: 'local', report };
  try {
    if (auth && !auth.currentUser) await signInAnonymously(auth);
    await deleteDoc(doc(db, MEALS_COLLECTION, mealId));
    return { success: true, storage: 'firebase', report };
  } catch (error) {
    console.warn('[reportStore] Firebase report delete failed, local record removed.', error);
    return { success: true, storage: 'local', report, error };
  }
}

export async function restoreNutritionReport(report) {
  if (!report?.mealId) return { success: false, error: new Error('복원할 기록이 없습니다.') };
  const reports = readLocalReports().filter((item) => item.mealId !== report.mealId);
  reports.unshift(report);
  const localSaved = tryWriteLocalReports(reports);
  if (!localSaved) return { success: false, error: new Error('기기 기록을 복원하지 못했습니다.') };

  if (!firebaseEnabled || !db) return { success: true, storage: 'local' };
  try {
    if (auth && !auth.currentUser) await signInAnonymously(auth);
    const { imageUrl, ...cloudReport } = report;
    await setDoc(doc(db, MEALS_COLLECTION, report.mealId), {
      ...cloudReport,
      imageUrl: '',
      createdAt: new Date(report.createdAt),
      updatedAt: serverTimestamp(),
      uid: auth?.currentUser?.uid || null,
    });
    return { success: true, storage: 'firebase' };
  } catch (error) {
    console.warn('[reportStore] Firebase report restore failed, local record restored.', error);
    return { success: true, storage: 'local', error };
  }
}

function buildMealHistoryPayload(report, imageUrl = '', eatenAt) {
  const items = report.items.map(toMealHistoryItem);
  const hasPendingInfo = items.some((item) => item.isPendingInfo);
  const recordedAt = new Date().toISOString();
  const createdAt = eatenAt ? new Date(eatenAt).toISOString() : recordedAt;

  return {
    userId: 'anonymous',
    mealId: `meal_${createdAt.replace(/\D/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    recordedAt,
    updatedAt: recordedAt,
    mealType: inferMealType(new Date(createdAt)),
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
  const consumedAmount = Number(item.grams || 0);
  const servingAmount = Number(item.servingAmount || 0);
  const servingUnit = item.servingUnit || (item.perServing ? '회' : 'g');

  return {
    foodName: item.name,
    nameConfirmed: Boolean(item.nameConfirmed),
    portionSource: item.portionSource || 'unknown',
    portionConfirmed: Boolean(item.portionConfirmed),
    portionChoice: item.portionChoice || '',
    nutrientBasisGrams: item.nutrientBasisGrams || 0,
    official: Boolean(item.official),
    matched: Boolean(item.matched),
    missingNutrients: item.missingNutrients || [],
    position: item.position || null,
    isPendingInfo: pending,
    servingSizeGrams: servingUnit === 'g' ? consumedAmount : servingUnit === 'kg' ? consumedAmount * 1000 : item.perServing ? 0 : consumedAmount,
    servingVolumeMl: servingUnit === 'mL' ? consumedAmount : servingUnit === 'L' ? consumedAmount * 1000 : 0,
    servingCount: item.perServing ? consumedAmount / Math.max(servingAmount || 1, 0.01) : 0,
    consumedAmount,
    servingAmount,
    servingUnit,
    servingLabel: item.serving || '',
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
  if (!tryWriteLocalReports(reports)) return { success: false, storage: 'local', error: new Error('기기 기록을 수정하지 못했습니다.') };

  return { success: true, storage: 'local', status };
}

function updateLocalNutritionReport(mealId, changes = {}) {
  const reports = readLocalReports();
  const index = reports.findIndex((report) => report.mealId === mealId);
  if (index < 0) return { success: false, error: new Error('수정할 기록을 찾을 수 없습니다.') };

  const current = reports[index];
  if (changes.createdAt && (!Number.isFinite(new Date(changes.createdAt).getTime()) || new Date(changes.createdAt) > new Date())) return { success: false, error: new Error('식사 날짜와 시간을 확인해 주세요.') };
  const items = Array.isArray(changes.items) && changes.items.length ? changes.items : current.items || [];
  const createdAt = normalizeDateTime(changes.createdAt, current.createdAt);
  const originalAnalysis = current.originalAnalysis || {
    createdAt: current.createdAt,
    mealType: current.mealType,
    summary: current.summary,
    items: current.items || [],
    totals: current.totals || {},
  };
  const next = {
    ...current,
    ...changes,
    createdAt,
    mealType: changes.mealType || current.mealType || inferMealType(new Date(createdAt)),
    items,
    summary: items.map((item) => String(item.foodName || '').trim()).filter(Boolean).join(', ') || current.summary,
    totals: sumHistoryItems(items),
    macroPercent: getMacroBreakdown(sumHistoryItems(items)),
    originalAnalysis,
    userCorrected: true,
    correctedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  reports[index] = next;
  if (!tryWriteLocalReports(reports)) {
    return { success: false, error: new Error('기기 기록을 수정하지 못했습니다.') };
  }
  return { success: true, storage: 'local', report: next };
}

function normalizeDateTime(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function sumHistoryItems(items) {
  return items.reduce(
    (acc, item) => {
      acc.missingNutrients = [...new Set([...acc.missingNutrients, ...(item.missingNutrients || []), ...(item.isPendingInfo ? ['calories', 'carb', 'protein', 'fat'] : [])])];
      if (item.isPendingInfo) return acc;
      const nutrients = item.nutrients || {};
      acc.calories += Number(nutrients.calories || 0);
      acc.carb += Number(nutrients.carbohydrates || 0);
      acc.protein += Number(nutrients.protein || 0);
      acc.fat += Number(nutrients.fat || 0);
      acc.sodium += Number(nutrients.sodium || 0);
      acc.sugar += Number(nutrients.sugar || 0);
      return acc;
    },
    { calories: 0, carb: 0, protein: 0, fat: 0, sodium: 0, sugar: 0, missingNutrients: [] },
  );
}

function saveLocalReport(payload) {
  const reports = readLocalReports();
  reports.unshift(payload);
  // Preserve every dated meal so older calendar months remain available.
  const limitedReports = reports;
  if (tryWriteLocalReports(limitedReports)) return true;

  const keepRecentPhotos = limitedReports.map((report, index) => (index < 8 ? report : { ...report, imageUrl: '' }));
  if (tryWriteLocalReports(keepRecentPhotos)) return true;

  const newestPhotoOnly = limitedReports.map((report, index) => (index === 0 ? report : { ...report, imageUrl: '' }));
  if (tryWriteLocalReports(newestPhotoOnly)) return true;

  return tryWriteLocalReports(limitedReports.map((report) => ({ ...report, imageUrl: '' })));
}

function inferMealType(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return '아침';
  if (hour >= 11 && hour < 16) return '점심';
  if (hour >= 16 && hour < 22) return '저녁';
  return '간식·기타';
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
