import { describe, expect, test } from 'bun:test';
import { copenhagenDay, isWeekend, lessonsPerDay, nextDay } from './school-day.ts';

describe('copenhagenDay', () => {
  test('uses Copenhagen, not UTC', () => {
    expect(copenhagenDay('2026-10-04T22:30:00Z')).toBe('2026-10-05');
    expect(copenhagenDay(new Date('2026-10-10T04:30:00Z'))).toBe('2026-10-10');
    expect(copenhagenDay('garbage')).toBeUndefined();
  });
});

describe('nextDay and isWeekend', () => {
  test('only Saturday has a weekend today and tomorrow', () => {
    const both = (d: string) => isWeekend(d) && isWeekend(nextDay(d));
    expect(both('2026-10-09')).toBe(false); // Friday
    expect(both('2026-10-10')).toBe(true); // Saturday
    expect(both('2026-10-11')).toBe(false); // Sunday
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});

describe('lessonsPerDay', () => {
  test('counts lessons by Copenhagen day and ignores other events', () => {
    const ev = (type: string, start: string) => ({
      type,
      startDateTime: start,
      endDateTime: start,
    });
    expect(
      lessonsPerDay([
        ev('lesson', '2026-10-05T08:00:00+02:00'),
        ev('lesson', '2026-10-05T09:00:00+02:00'),
        ev('lesson', '2026-10-05T22:30:00Z'),
        ev('event', '2026-10-05T10:00:00+02:00'),
      ]),
    ).toEqual({ '2026-10-05': 2, '2026-10-06': 1 });
  });
});
