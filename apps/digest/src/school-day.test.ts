import { describe, expect, test } from 'bun:test';
import { copenhagenDay, hasSchoolTodayOrTomorrow, isSchoolDay } from './school-day.ts';

const ev = (type: string, start: string, end: string) => ({
  type,
  startDateTime: start,
  endDateTime: end,
});
const lesson = (day: string) => ev('lesson', `${day}T08:00:00+02:00`, `${day}T09:00:00+02:00`);

// 2026-10-12 is a Monday; week 42 (Oct 12-16) stands in for autumn break below.
const week41 = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(lesson);
const week43 = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map(lesson);

describe('copenhagenDay', () => {
  test('uses Copenhagen, not UTC', () => {
    expect(copenhagenDay('2026-10-04T22:30:00Z')).toBe('2026-10-05');
    expect(copenhagenDay('garbage')).toBeUndefined();
  });
});

describe('isSchoolDay', () => {
  test('weekends never count, even with lessons', () => {
    expect(isSchoolDay('2026-10-10', [...week41, lesson('2026-10-10')])).toBe(false);
  });

  test('a week with lessons decides by lessons', () => {
    const missingThursday = week41.filter((e) => !e.startDateTime.startsWith('2026-10-08'));
    expect(isSchoolDay('2026-10-07', missingThursday)).toBe(true);
    expect(isSchoolDay('2026-10-08', missingThursday)).toBe(false);
  });

  test('a week without lessons falls back to weekdays minus holidays', () => {
    expect(isSchoolDay('2026-10-12', week41)).toBe(true);
    const autumnBreak = ev('holiday', '2026-10-12T00:00:00+02:00', '2026-10-17T00:00:00+02:00');
    expect(isSchoolDay('2026-10-12', [autumnBreak])).toBe(false);
    expect(isSchoolDay('2026-10-16', [autumnBreak])).toBe(false);
  });

  test('an all-day holiday with end equal to start covers its day only', () => {
    const day = ev('holiday', '2026-10-14T00:00:00+02:00', '2026-10-14T00:00:00+02:00');
    expect(isSchoolDay('2026-10-14', [day])).toBe(false);
    expect(isSchoolDay('2026-10-15', [day])).toBe(true);
  });
});

describe('hasSchoolTodayOrTomorrow', () => {
  // Cron fires 04:30 UTC.
  const at = (day: string) => new Date(`${day}T04:30:00Z`);

  test('Friday and Sunday send, Saturday skips', () => {
    const events = [...week41, ...week43];
    expect(hasSchoolTodayOrTomorrow(week41, at('2026-10-09'))).toBe(true);
    expect(hasSchoolTodayOrTomorrow(week41, at('2026-10-10'))).toBe(false);
    expect(hasSchoolTodayOrTomorrow(events, at('2026-10-18'))).toBe(true);
  });

  test('holiday weeks skip until the day before school restarts', () => {
    const autumnBreak = ev('holiday', '2026-10-12T00:00:00+02:00', '2026-10-16T23:59:00+02:00');
    const events = [...week41, autumnBreak, ...week43];
    expect(hasSchoolTodayOrTomorrow(events, at('2026-10-11'))).toBe(false);
    expect(hasSchoolTodayOrTomorrow(events, at('2026-10-14'))).toBe(false);
    expect(hasSchoolTodayOrTomorrow(events, at('2026-10-16'))).toBe(false);
    expect(hasSchoolTodayOrTomorrow(events, at('2026-10-18'))).toBe(true);
  });
});
