import { describe, expect, test } from 'bun:test';
import { isAfter, schoolworkTools, upcomingEvents } from './collect.ts';

describe('isAfter', () => {
  const since = new Date('2026-10-04T06:00:00Z');

  test('compares across offsets', () => {
    expect(isAfter('2026-10-04T08:30:00+02:00', since)).toBe(true);
    expect(isAfter('2026-10-04T07:30:00+02:00', since)).toBe(false);
  });

  test('treats missing or unparseable timestamps as old', () => {
    expect(isAfter(undefined, since)).toBe(false);
    expect(isAfter('garbage', since)).toBe(false);
  });
});

describe('upcomingEvents', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  const ev = (type: string, title: string, start: string, end: string) => ({
    type,
    title,
    startDateTime: start,
    endDateTime: end,
  });

  test('drops lessons and finished events, sorts by start', () => {
    const result = upcomingEvents(
      [
        ev('event', 'Skovtur', '2026-10-08T08:00:00+02:00', '2026-10-08T14:00:00+02:00'),
        ev('lesson', 'Dansk', '2026-10-05T08:00:00+02:00', '2026-10-05T09:00:00+02:00'),
        ev('event', 'Forældremøde', '2026-10-06T17:00:00+02:00', '2026-10-06T19:00:00+02:00'),
        ev('event', 'Fortid', '2026-10-01T08:00:00+02:00', '2026-10-01T09:00:00+02:00'),
      ],
      now,
    );
    expect(result.map((e) => e.title)).toEqual(['Forældremøde', 'Skovtur']);
  });
});

describe('schoolworkTools', () => {
  test('maps detected widgets to their tools and ignores unknown ones', () => {
    expect(schoolworkTools(['0029', '0030', '9999'])).toEqual([
      'aula.ugebrev.minuddannelse',
      'aula.opgaver.minuddannelse',
    ]);
  });
});
