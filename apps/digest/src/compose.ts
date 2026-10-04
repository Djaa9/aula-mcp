import Anthropic from '@anthropic-ai/sdk';
import type { DigestData } from './collect.ts';

const SYSTEM = `Du skriver en daglig Aula-oversigt til en forælder, som læser den som e-mail om morgenen.

Du får skoledata som JSON: børn, kommende arrangementer, nye beskeder og opslag siden sidste oversigt, samt lektier/ugeplaner/ugebreve fra skolens systemer.

Skriv på dansk. Returnér kun et HTML-fragment (ingen <html>, <head> eller <body>, ingen markdown-kodeblok) med simple tags: h2, h3, p, ul, li, strong. Ingen inline-styles.

Struktur:
1. En kort indledning på én sætning med det vigtigste i dag.
2. Én sektion pr. barn (h2 med barnets fornavn) med de underafsnit der har indhold: "I dag og i morgen", "Lektier", "Ture og arrangementer" (de næste 7 dage), "Ugeplan" (kun det der er relevant for i dag og i morgen).
3. "Nye beskeder": hver tråd med emne, afsender og et resumé på 1-3 sætninger. Hvis noget kræver svar eller handling fra forælderen (tilmelding, betaling, noget der skal medbringes), markér det med <strong>Kræver handling:</strong> og nævn fristen. Følsomme tråde vises som "Følsom besked – åbn i Aula".
4. "Opslag": kort resumé af nye opslag.

Udelad tomme afsnit. Hvis der ikke er noget nyt, så skriv det kort i stedet for at fylde ud. Datoer skrives som "mandag 12. maj", tider som "kl. 8.15". Tidszonen er Europe/Copenhagen. Opfind aldrig information, der ikke står i dataene.`;

export interface ComposedDigest {
  subject: string;
  html: string;
}

export async function composeDigest(data: DigestData, now: Date): Promise<ComposedDigest> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: process.env.DIGEST_MODEL ?? 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(data) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Claude declined to write the digest (${response.stop_details?.category ?? 'no category'})`,
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude hit max_tokens before finishing the digest');
  }
  const html = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const date = new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return { subject: `Aula ${date}`, html };
}
