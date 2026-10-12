/**
 * One digest run: seed tokens if needed, collect, compose, send, exit.
 * Built for a Railway cron service, which must exit for the next run to fire.
 *
 * DIGEST_DRY_RUN=1 writes the HTML to a temp file instead of sending, and
 * leaves lastRunAt untouched so the next run still sees the same messages.
 *
 * Runs with no school today or tomorrow send nothing and leave lastRunAt
 * alone, so the next digest covers the gap. Saturdays are skipped before any
 * fetching; on other days Claude judges holidays from the collected data. If
 * that check fails, the digest is sent. DIGEST_FORCE=1 sends anyway.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AulaContext } from '@aula-mcp/mcp-server';
import { collect, collectCalendar, connectInProcess } from './collect.ts';
import { composeDigest } from './compose.ts';
import { copenhagenDay, isWeekend, judgeSchoolDays, nextDay } from './school-day.ts';
import { sendEmail } from './send.ts';
import { configDir, readLastRunAt, seedTokens, writeLastRunAt } from './state.ts';

const dryRun = process.env.DIGEST_DRY_RUN === '1';
const force = process.env.DIGEST_FORCE === '1';

async function main(): Promise<void> {
  const dir = configDir();
  if (await seedTokens(dir)) console.error(`Seeded tokens into ${dir}`);

  const now = new Date();
  const since = await readLastRunAt(dir, now);

  const context = new AulaContext();
  try {
    const client = await connectInProcess(context);
    // Fetched even on Saturdays so token refresh keeps running and login failures email.
    const calendar = await collectCalendar(client);
    const today = copenhagenDay(now) as string;
    if (!force && isWeekend(today) && isWeekend(nextDay(today))) {
      console.error('Weekend: skipping digest');
      return;
    }
    const data = await collect(client, calendar, since, now);
    console.error(
      `Collected ${data.messages.length} threads, ${data.posts.length} posts, ${data.events.length} events since ${data.since}`,
    );
    if (!force) {
      try {
        const verdict = await judgeSchoolDays(data, calendar.events, now);
        console.error(
          `School today: ${verdict.schoolToday}, tomorrow: ${verdict.schoolTomorrow} (${verdict.reason})`,
        );
        if (!verdict.schoolToday && !verdict.schoolTomorrow) {
          console.error('No school today or tomorrow: skipping digest');
          return;
        }
      } catch (e) {
        console.error(`School-day check failed, sending anyway: ${e}`);
      }
    }
    const digest = await composeDigest(data, now);

    if (dryRun) {
      const path = join(tmpdir(), 'aula-digest.html');
      await writeFile(path, `<h1>${digest.subject}</h1>\n${digest.html}`, 'utf8');
      console.error(`Dry run: wrote ${path}`);
      return;
    }
    await sendEmail(digest.subject, digest.html);
    await writeLastRunAt(dir, now);
    console.error(`Sent "${digest.subject}"`);
  } finally {
    context.dispose();
  }
}

try {
  await main();
  process.exit(0);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`Digest failed: ${message}`);
  // An unattended job that fails silently is the real risk: tell the inbox.
  if (!dryRun) {
    try {
      await sendEmail(
        'Aula-digest fejlede',
        `<p>Dagens Aula-oversigt kunne ikke laves:</p><pre>${message.replace(/</g, '&lt;')}</pre>` +
          '<p>Skyldes det login: kør <code>pnpm aula login</code> og <code>pnpm aula tokens export</code> hjemme, ' +
          'og opdatér AULA_TOKENS_SEED og AULA_MCP_KEY på Railway. Den nye seed bruges ved næste kørsel.</p>',
      );
    } catch (sendError) {
      console.error(`Could not send failure email either: ${sendError}`);
    }
  }
  process.exit(1);
}
