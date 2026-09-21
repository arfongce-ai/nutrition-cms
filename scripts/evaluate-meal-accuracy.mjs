import { readFile } from 'node:fs/promises';
import { evaluateMeals } from '../src/services/recognitionEvaluation.js';

try {
  const path = process.argv[2];
  if (!path) throw new Error('사용법: node scripts/evaluate-meal-accuracy.mjs <실측 자료.json>');
  const records = JSON.parse(await readFile(path, 'utf8'));
  const overall = evaluateMeals(records);
  const groups = Object.fromEntries([...new Set(records.map((row) => row.group || '미분류'))].map((group) => [group, evaluateMeals(records.filter((row) => (row.group || '미분류') === group))]));
  console.log(JSON.stringify({ evaluatedAt: new Date().toISOString(), overall, groups }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
