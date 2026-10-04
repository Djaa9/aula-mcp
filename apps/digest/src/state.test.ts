import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLastRunAt, seedTokens, writeLastRunAt } from './state.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'digest-state-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('seedTokens', () => {
  test('does nothing without a seed', async () => {
    expect(await seedTokens(dir, {})).toBe(false);
  });

  test('writes the decoded seed on first run', async () => {
    expect(await seedTokens(dir, { AULA_TOKENS_SEED: b64('{"v":1}') })).toBe(true);
    expect(await readFile(join(dir, 'tokens.json'), 'utf8')).toBe('{"v":1}');
  });

  test('does not roll back rotated tokens when the seed is unchanged', async () => {
    const env = { AULA_TOKENS_SEED: b64('{"v":1}') };
    await seedTokens(dir, env);
    await writeFile(join(dir, 'tokens.json'), '{"v":"rotated"}');
    expect(await seedTokens(dir, env)).toBe(false);
    expect(await readFile(join(dir, 'tokens.json'), 'utf8')).toBe('{"v":"rotated"}');
  });

  test('applies a new seed after a fresh login', async () => {
    await seedTokens(dir, { AULA_TOKENS_SEED: b64('{"v":1}') });
    expect(await seedTokens(dir, { AULA_TOKENS_SEED: b64('{"v":2}') })).toBe(true);
    expect(await readFile(join(dir, 'tokens.json'), 'utf8')).toBe('{"v":2}');
  });
});

describe('lastRunAt', () => {
  const now = new Date('2026-10-05T04:30:00Z');

  test('defaults to 24h back on first run', async () => {
    expect((await readLastRunAt(dir, now)).toISOString()).toBe('2026-10-04T04:30:00.000Z');
  });

  test('round-trips', async () => {
    await writeLastRunAt(dir, now);
    expect((await readLastRunAt(dir, new Date())).toISOString()).toBe(now.toISOString());
  });

  test('falls back on a corrupt file', async () => {
    await writeFile(join(dir, 'digest-state.json'), 'not json');
    expect((await readLastRunAt(dir, now)).toISOString()).toBe('2026-10-04T04:30:00.000Z');
  });
});
