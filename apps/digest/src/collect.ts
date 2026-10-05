/**
 * Fetches everything the digest needs by calling aula-mcp's own tools through
 * an in-memory MCP transport. Going through the tools rather than AulaClient
 * keeps vendor detection, integration-context building and guardian-profile
 * priming in one place (packages/mcp-server/src/tools.ts).
 */

import {
  type AulaContext,
  type DiscoverManifest,
  htmlToText,
  registerTools,
  WIDGET_PROVIDER_MAP,
} from '@aula-mcp/mcp-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const MAX_THREAD_PAGES = 5;
/**
 * The school announces trips and deadlines in messages, often days or weeks
 * ahead, so the model needs older messages too to see what falls today.
 */
export const LOOKBACK_DAYS = 30;

interface ThreadSummary {
  id: number;
  subject?: string;
  lastMessage?: { sendDateTime?: string };
  latestMessage?: { sendDateTime?: string };
}

interface ThreadMessage {
  sender?: { fullName?: string };
  sendDateTime?: string;
  text?: { html?: string; plain?: string };
  attachments?: Array<{ file?: { name?: string } }>;
}

interface CalendarEvent {
  type: string;
  title?: string;
  startDateTime: string;
  endDateTime: string;
  belongsToProfiles?: number[];
}

interface Post {
  title?: string;
  date?: string;
  author?: string;
  institution?: string;
  isImportant?: boolean;
  content?: string;
  attachments?: Array<{ name?: string }>;
}

export interface CollectedMessage {
  threadId: number;
  subject: string;
  sensitive?: true;
  messages: Array<{
    from?: string;
    sentAt?: string;
    isNew: boolean;
    text: string;
    attachments?: string[];
  }>;
}

export interface DigestData {
  generatedAt: string;
  since: string;
  /** Messages and posts go back to here; `isNew` marks those after `since`. */
  windowStart: string;
  children: DiscoverManifest['children'];
  events: CalendarEvent[];
  messages: CollectedMessage[];
  posts: Array<Post & { isNew: boolean }>;
  /** Keyed by tool name; value is the tool's JSON, or `{ error }` if that vendor failed. */
  schoolwork: Record<string, unknown>;
}

export async function connectInProcess(context: AulaContext): Promise<Client> {
  const server = new McpServer({ name: 'aula-mcp', version: 'digest' });
  registerTools(server, context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'aula-digest', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  const first = (res.content as Array<{ type: string; text?: string }>)[0];
  const text = first?.type === 'text' ? (first.text ?? '') : '';
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as T;
}

export function isAfter(timestamp: string | undefined, since: Date): boolean {
  if (!timestamp) return false;
  const t = Date.parse(timestamp);
  return !Number.isNaN(t) && t > since.getTime();
}

/** Non-lesson events (trips, meetings, holidays) that haven't ended yet. */
export function upcomingEvents(events: CalendarEvent[], now: Date): CalendarEvent[] {
  return events
    .filter((e) => e.type !== 'lesson' && isAfter(e.endDateTime, now))
    .sort((a, b) => Date.parse(a.startDateTime) - Date.parse(b.startDateTime));
}

/** Vendor tools for the widgets this family's schools actually have. */
export function schoolworkTools(detectedWidgets: string[]): string[] {
  const tools = detectedWidgets
    .map((id) => WIDGET_PROVIDER_MAP[id]?.tool)
    .filter((t): t is string => t !== undefined);
  // MU serves the opgaveliste to schools that don't enable widget 0030 in Aula
  // (verified 2026-10-05), so a school with MU ugebrev gets it too.
  if (detectedWidgets.includes('0029')) tools.push('aula.opgaver.minuddannelse');
  return [...new Set(tools)];
}

function lastSent(t: ThreadSummary): string | undefined {
  return t.latestMessage?.sendDateTime ?? t.lastMessage?.sendDateTime;
}

async function collectMessages(
  client: Client,
  since: Date,
  windowStart: Date,
): Promise<CollectedMessage[]> {
  const fresh: ThreadSummary[] = [];
  for (let page = 0; page < MAX_THREAD_PAGES; page++) {
    const res = await callTool<{ threads: ThreadSummary[]; hasMorePages: boolean }>(
      client,
      'aula.messages.list_threads',
      { page },
    );
    const updated = res.threads.filter((t) => isAfter(lastSent(t), windowStart));
    fresh.push(...updated);
    // Threads come newest first, so a page with stale threads means we're done.
    if (updated.length < res.threads.length || !res.hasMorePages) break;
  }

  const out: CollectedMessage[] = [];
  for (const thread of fresh) {
    const res = await callTool<{ error?: string; subject?: string; messages?: ThreadMessage[] }>(
      client,
      'aula.messages.get_thread',
      { threadId: thread.id },
    );
    const subject = res.subject ?? thread.subject ?? '(uden emne)';
    if (res.error === 'step_up_required') {
      // Only the subject is visible, so an old one tells the reader nothing new.
      if (isAfter(lastSent(thread), since))
        out.push({ threadId: thread.id, subject, sensitive: true, messages: [] });
      continue;
    }
    const messages = (res.messages ?? [])
      .filter((m) => isAfter(m.sendDateTime, windowStart))
      .map((m) => {
        const attachments = (m.attachments ?? [])
          .map((a) => a.file?.name)
          .filter((n): n is string => !!n);
        return {
          ...(m.sender?.fullName ? { from: m.sender.fullName } : {}),
          ...(m.sendDateTime ? { sentAt: m.sendDateTime } : {}),
          isNew: isAfter(m.sendDateTime, since),
          text: m.text?.plain ?? htmlToText(m.text?.html ?? ''),
          ...(attachments.length ? { attachments } : {}),
        };
      });
    out.push({ threadId: thread.id, subject, messages });
  }
  return out;
}

export async function collect(client: Client, since: Date, now: Date): Promise<DigestData> {
  const manifest = await callTool<DiscoverManifest>(client, 'aula.discover');
  const windowStart = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const children = manifest.children;
  const childIds = children.map((c) => c.id);
  const institutionCodes = [
    ...new Set(children.map((c) => c.institution?.code).filter((c): c is string => !!c)),
  ];

  const [thisWeek, nextWeek, messages, posts, schoolworkEntries] = await Promise.all([
    callTool<CalendarEvent[]>(client, 'aula.calendar.events', {
      profileIds: childIds,
      range: 'this_week',
    }),
    callTool<CalendarEvent[]>(client, 'aula.calendar.events', {
      profileIds: childIds,
      range: 'next_week',
    }),
    collectMessages(client, since, windowStart),
    callTool<{ posts: Post[] }>(client, 'aula.posts.list', { limit: 50 }),
    Promise.all(
      schoolworkTools(manifest.detectedWidgets).map(async (tool) => {
        try {
          return [tool, await callTool(client, tool, { childIds, institutionCodes })] as const;
        } catch (e) {
          // One vendor being down shouldn't cost the whole digest.
          return [tool, { error: e instanceof Error ? e.message : String(e) }] as const;
        }
      }),
    ),
  ]);

  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    windowStart: windowStart.toISOString(),
    children,
    events: upcomingEvents([...thisWeek, ...nextWeek], now),
    messages,
    posts: posts.posts
      .filter((p) => isAfter(p.date, windowStart))
      .map((p) => ({ ...p, isNew: isAfter(p.date, since) })),
    schoolwork: Object.fromEntries(schoolworkEntries),
  };
}
