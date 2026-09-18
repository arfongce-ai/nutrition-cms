import { localDateTime, mealTypeAt } from './diaryInsights.js';

// EXIF has camera-local wall time; do not substitute filesystem modification time.
export function exifLocalTime(value) {
  if (value instanceof Date) return localDateTime(value);
  const match = String(value || '').match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return '';
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  if (date.getFullYear() !== +y || date.getMonth() !== +mo - 1 || date.getDate() !== +d || date.getHours() !== +h || date.getMinutes() !== +mi || date.getSeconds() !== +s) return '';
  return localDateTime(date);
}

export async function readPhotoTiming(file, now = new Date()) {
  let time = '';
  try {
    const exifr = await import('exifr');
    const parse = exifr.parse || exifr.default?.parse;
    const data = await parse(file, { pick: ['DateTimeOriginal'], reviveValues: false, gps: false });
    time = exifLocalTime(data?.DateTimeOriginal);
  } catch { /* The user supplies missing or unsupported metadata. */ }
  if (time && new Date(time) > now) time = '';
  return { dateTime: time || localDateTime(now), timeSource: time ? 'exif' : 'manual', timeConfirmed: Boolean(time), mealType: mealTypeAt(time || now) };
}
