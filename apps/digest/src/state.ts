import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.AULA_MCP_DIR ?? join(homedir(), '.config', 'aula-mcp');
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * `aula login` can't run on Railway (STIL bot protection blocks datacenter
 * IPs), so the encrypted tokens.json made at home arrives base64-encoded in
 * AULA_TOKENS_SEED. It is applied once per distinct seed: after that the
 * volume holds the rotated refresh token and re-applying the seed would roll
 * it back. Setting a new seed (after a fresh login) applies it on the next run.
 */
export async function seedTokens(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const seed = env.AULA_TOKENS_SEED;
  if (!seed) return false;
  const hash = createHash('sha256').update(seed).digest('hex');
  const hashPath = join(dir, 'seed.sha256');
  if ((await readOptional(hashPath))?.trim() === hash) return false;

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tokens.json'), Buffer.from(seed, 'base64').toString('utf8'), {
    mode: 0o600,
  });
  await writeFile(hashPath, hash, 'utf8');
  return true;
}

export interface DigestState {
  lastRunAt: string;
}

export async function readLastRunAt(dir: string, now: Date, fallbackHours = 24): Promise<Date> {
  const raw = await readOptional(join(dir, 'digest-state.json'));
  if (raw) {
    try {
      const parsed = new Date((JSON.parse(raw) as DigestState).lastRunAt);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    } catch {
      // Corrupt state file: fall back to the default window.
    }
  }
  return new Date(now.getTime() - fallbackHours * 3600_000);
}

export async function writeLastRunAt(dir: string, at: Date): Promise<void> {
  const state: DigestState = { lastRunAt: at.toISOString() };
  await writeFile(join(dir, 'digest-state.json'), JSON.stringify(state, null, 2), 'utf8');
}
