/**
 * Decides whether a digest is worth sending: only when the kids have school
 * today or tomorrow (Copenhagen days). A regular Saturday and every day of a
 * holiday except the last one are skipped.
 *
 * Weekends are settled here in code. Whether a weekday is a holiday is left to
 * Claude: the school doesn't mark holidays in the Aula calendar, but the model
 * knows the Danish school year (efterårsferie in week 42 and so on) and can
 * read lessons, events, posts and messages for hints.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { DigestData } from './collect.ts';

interface DayEvent {
  type: string;
  title?: string;
  startDateTime: string;
  endDateTime: string;
}

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

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(day: string): boolean {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Number of lessons per Copenhagen day. */
export function lessonsPerDay(events: DayEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== 'lesson') continue;
    const day = copenhagenDay(e.startDateTime);
    if (day) out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

export interface SchoolVerdict {
  schoolToday: boolean;
  schoolTomorrow: boolean;
  reason: string;
}

const SYSTEM = `Du afgør, om en dansk folkeskole har undervisning i dag og i morgen, så en daglig Aula-oversigt kun sendes på dage, hvor det er relevant.

Skolen markerer ikke ferier i Aula-kalenderen. Brug derfor:
- Dit kendskab til det danske skoleår: sommerferie (slut juni til ca. midt august), efterårsferie (typisk uge 42), juleferie, vinterferie (uge 7 eller 8 afhængig af kommune), påskeferie, Kristi himmelfartsdag og fredagen efter, 2. pinsedag og grundlovsdag (Store Bededag er afskaffet). Kommunerne fastlægger selv ferieplanen, så brug skolens navn som hint om kommunen.
- Lektioner pr. dag fra Aula-skemaet, hvis skolen lægger skemaet i Aula. Mangler lektioner for en hel uge, kan det både betyde ferie og at skemaet ikke er lagt ind.
- Arrangementer, opslag og beskeder (fx "God efterårsferie", "skolen er lukket", "første skoledag").

Konkrete oplysninger fra skolen vejer tungere end den generelle ferieplan. Er du i tvivl, så svar at der er skole: en overflødig e-mail er bedre end en manglende. Weekenddage er aldrig skoledage. Giv en kort begrundelse på dansk.`;

const SCHEMA = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    schoolToday: { type: 'boolean' },
    schoolTomorrow: { type: 'boolean' },
  },
  required: ['reason', 'schoolToday', 'schoolTomorrow'],
  additionalProperties: false,
};

const clip = (s: string | undefined, n = 500) =>
  s && s.length > n ? `${s.slice(0, n)}…` : (s ?? '');

const weekdayFmt = new Intl.DateTimeFormat('da-DK', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const describeDay = (day: string) => `${day} (${weekdayFmt.format(new Date(`${day}T00:00:00Z`))})`;

/** Asks Claude whether today and tomorrow are school days. `calendar` includes lessons. */
export async function judgeSchoolDays(
  data: DigestData,
  calendar: DayEvent[],
  now: Date,
): Promise<SchoolVerdict> {
  const today = copenhagenDay(now) as string;
  const tomorrow = nextDay(today);
  const input = {
    today: describeDay(today),
    tomorrow: describeDay(tomorrow),
    schools: [...new Set(data.children.map((c) => c.institution?.name).filter(Boolean))],
    lessonsPerDayThisAndNextWeek: lessonsPerDay(calendar),
    events: data.events.map((e) => ({
      type: e.type,
      title: e.title,
      start: e.startDateTime,
      end: e.endDateTime,
    })),
    posts: data.posts.map((p) => ({ date: p.date, title: p.title, content: clip(p.content) })),
    messages: data.messages.map((t) => ({
      subject: t.subject,
      messages: t.messages.map((m) => ({ sentAt: m.sentAt, text: clip(m.text) })),
    })),
  };

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: process.env.DIGEST_MODEL ?? 'claude-opus-5-5',
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  });
  if (response.stop_reason !== 'end_turn') {
    throw new Error(`School-day check stopped with ${response.stop_reason}`);
  }
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const verdict = JSON.parse(text) as SchoolVerdict;
  // Weekends are not the model's call.
  return {
    ...verdict,
    schoolToday: verdict.schoolToday && !isWeekend(today),
    schoolTomorrow: verdict.schoolTomorrow && !isWeekend(tomorrow),
  };
}
