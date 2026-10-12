/**
 * Decides whether a digest is worth sending: only when the kids have school
 * today or tomorrow (Copenhagen days). A regular Saturday and every day of a
 * holiday except the last one are skipped.
 *
 * Weekends never count. On a weekday, lessons are the signal when that week
 * has any; otherwise fall back to "school unless a holiday event covers it".
 */

interface DayEvent {
  type: string;
  startDateTime: string;
  endDateTime: string;
}

/** Aula types for "no school": school holidays and a child's registered vacation. */
const HOLIDAY_TYPES = new Set(['holiday', 'presence_holiday']);

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of the instant as seen in Copenhagen, or undefined if unparseable. */
export function copenhagenDay(timestamp: string | Date): string | undefined {
  const t = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp.getTime();
  return Number.isNaN(t) ? undefined : dayKeyFmt.format(t);
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isWeekend(day: string): boolean {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Copenhagen days an event touches. An end at or before the start counts as its start day. */
function eventDays(e: DayEvent): string[] {
  const first = copenhagenDay(e.startDateTime);
  if (!first) return [];
  const endMs = Date.parse(e.endDateTime);
  const startMs = Date.parse(e.startDateTime);
  // End is exclusive: an all-day event ending at next midnight doesn't cover that day.
  const last = !Number.isNaN(endMs) && endMs > startMs ? copenhagenDay(new Date(endMs - 1)) : first;
  const days = [first];
  for (let d = first; last && d < last && days.length < 400; ) {
    d = nextDay(d);
    days.push(d);
  }
  return days;
}

function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function isSchoolDay(day: string, events: DayEvent[]): boolean {
  if (isWeekend(day)) return false;
  // Judge by lessons only in a week that has some: a week with none may just be
  // a schedule the school hasn't published (yet), not a holiday.
  const week = mondayOf(day);
  const lessonDays = events
    .filter((e) => e.type === 'lesson')
    .map((e) => copenhagenDay(e.startDateTime))
    .filter((d): d is string => d !== undefined && mondayOf(d) === week);
  if (lessonDays.length > 0) return lessonDays.includes(day);
  return !events.some((e) => HOLIDAY_TYPES.has(e.type) && eventDays(e).includes(day));
}

/** `events` must cover today and tomorrow, e.g. this week plus next week. */
export function hasSchoolTodayOrTomorrow(events: DayEvent[], now: Date): boolean {
  const today = copenhagenDay(now) as string;
  return isSchoolDay(today, events) || isSchoolDay(nextDay(today), events);
}
