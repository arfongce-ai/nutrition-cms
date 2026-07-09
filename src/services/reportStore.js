import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db, firebaseEnabled } from '../firebase';

const LOCAL_REPORTS_KEY = 'nutritionReports.v1';

export async function saveNutritionReport(report) {
  const payload = {
    createdAt: new Date().toISOString(),
    analysisType: report.analysisType,
    mode: report.profile.mode,
    stamp: report.stamp,
    summary: report.items.map((item) => item.name).join(', '),
    message: report.messageText,
    profile: report.profile,
    foods: report.foods,
    facts: report.facts,
    totals: report.totals,
    macroPercent: report.macroPercent,
    risk: report.risk,
    sourceItems: report.sourceItems,
  };

  saveLocalReport(payload);

  if (!firebaseEnabled || !db) {
    return { storage: 'local' };
  }

  try {
    if (auth && !auth.currentUser) {
      await signInAnonymously(auth);
    }
    await addDoc(collection(db, 'nutritionReports'), {
      ...payload,
      createdAt: serverTimestamp(),
      uid: auth?.currentUser?.uid || null,
    });
    return { storage: 'firebase' };
  } catch (error) {
    console.warn('[reportStore] Firebase save failed, local report kept.', error);
    return { storage: 'local', error };
  }
}

function saveLocalReport(payload) {
  const reports = readLocalReports();
  reports.unshift(payload);
  localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports.slice(0, 50)));
}

export function readLocalReports() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
