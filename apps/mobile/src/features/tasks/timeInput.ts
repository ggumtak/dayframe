/**
 * Reads a typed clock time as minutes after midnight, or null when it is not one. Accepts "17:30", "1730", "930", "9",
 * and "오후 5:30" / "오전 12시" style input; without 오전/오후 the hour is read on a 24-hour clock.
 */
export function parseTimeInput(text: string): number | null {
  const match = /^(오전|오후|am|pm)?\s*(?:(\d{3,4})|(\d{1,2})(?:(?::|시\s*)(\d{1,2})?\s*분?)?)$/i.exec(text.trim());
  if (!match) return null;
  const period = match[1]?.toLowerCase();
  let hour: number;
  let minute: number;
  if (match[2]) {
    hour = Number(match[2].slice(0, -2));
    minute = Number(match[2].slice(-2));
  } else {
    hour = Number(match[3]);
    minute = match[4] ? Number(match[4]) : 0;
  }
  if (minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period === '오후' || period === 'pm' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

/** "HH:MM" for the entry field. */
export const timeInputText = (minutes: number) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
