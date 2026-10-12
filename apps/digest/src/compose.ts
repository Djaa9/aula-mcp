import Anthropic from '@anthropic-ai/sdk';
import type { DigestData } from './collect.ts';

const SYSTEM = `Du skriver en daglig Aula-oversigt til en forælder, som læser den som e-mail om morgenen.

Du får skoledata som JSON: børn, kommende kalenderbegivenheder, beskeder og opslag fra de seneste 30 dage, samt lektier/ugeplaner/ugebreve fra skolens systemer. Beskeder og opslag har isNew: true, hvis de er kommet siden sidste oversigt.

Skolen bruger sjældent kalenderen. Ture, arrangementer, frister og ting der skal medbringes står oftest i beskeder og opslag, ofte sendt dage eller uger i forvejen. Gennemgå derfor alle beskeder og opslag, også de gamle, for alt der falder i dag eller de næste 7 dage.

Skriv på dansk. Returnér kun et HTML-fragment (ingen <html>, <head> eller <body>, ingen markdown-kodeblok) med simple tags: h2, h3, p, ul, li, strong. Ingen inline-styles.

Struktur:
1. En kort indledning på én sætning med det vigtigste i dag.
2. Én sektion pr. barn (h2 med barnets fornavn) med de underafsnit der har indhold: "I dag og i morgen", "Lektier" (kun opgaver der ikke er markeret som færdige), "Ture og arrangementer" (de næste 7 dage, fra både kalender, beskeder og opslag), "Ugeplan" (kun det der er relevant for i dag og i morgen).
3. "Nye beskeder": kun tråde med beskeder hvor isNew er true. Hver tråd med emne, afsender og et resumé på 1-3 sætninger af de nye beskeder; ældre beskeder i tråden er kun baggrund. Hvis noget kræver svar eller handling fra forælderen (tilmelding, betaling, noget der skal medbringes), markér det med <strong>Kræver handling:</strong> og nævn fristen. Følsomme tråde vises som "Følsom besked – åbn i Aula".
4. "Opslag": kort resumé af opslag hvor isNew er true.

Udelad tomme afsnit. Hvis der ikke er noget nyt, så skriv det kort i stedet for at fylde ud. Datoer skrives som "mandag 12. maj", tider som "kl. 8.15". Tidszonen er Europe/Copenhagen. Opfind aldrig information, der ikke står i dataene, og gæt ikke på hvilket barn noget gælder, hvis det ikke fremgår.`;

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
