/**
 * Sanitização de texto vindo do DOM do Meet — tratado como não confiável.
 * Só trabalhamos com textContent (nunca HTML), mas ainda normalizamos:
 * caracteres de controle, espaços redundantes e tamanho máximo.
 */

const MAX_TEXT_LENGTH = 4000;
const MAX_NAME_LENGTH = 120;

// Controles C0/C1, zero-width e separadores de linha unicode.

const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029]/g;

export function sanitizeCaptionText(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function sanitizeSpeakerName(raw: string | null): string | null {
  if (raw === null) return null;
  const clean = desfazerNomeDuplicado(
    raw
      .replace(CONTROL_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH),
  );
  return clean.length > 0 ? clean : null;
}

/**
 * O Meet às vezes entrega o nome colado a uma segunda cópia dele, sem espaço:
 * "Ana Souzaana Souza", "Carlos Lima Duartecarlos". Visto numa reunião real em
 * 25/11/2026, em TODOS os participantes — e o nome duplicado ia para a
 * transcrição, a ata e a lista de participantes. A cópia começa no meio de uma
 * palavra, repete o começo do próprio nome e começa pelo primeiro nome INTEIRO
 * — sem essa última condição, "Marimar" virava "Mari".
 */
export function desfazerNomeDuplicado(nome: string): string {
  const minusculo = nome.toLocaleLowerCase('pt-BR');
  const primeiroNome = minusculo.split(' ')[0]!;
  for (let i = 3; i <= nome.length - 3; i += 1) {
    if (/\s/.test(nome[i - 1]!) || /\s/.test(nome[i]!)) continue;
    const resto = minusculo.slice(i);
    if (resto.startsWith(primeiroNome) && minusculo.slice(0, i).startsWith(resto)) {
      return nome.slice(0, i);
    }
  }
  return nome;
}

/** No máximo os N primeiros nomes: nome comprido não domina a coluna de falas. */
const MAX_NAME_WORDS = 3;

/** Conectores que ficam minúsculos e não contam como "um nome" (Ana de Souza). */
const NAME_PARTICLES = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'della', 'van',
  'von', 'la', 'le', 'y', 'bin', 'al', 'da.', 'do.',
]);

/**
 * Rótulos que o Meet usa para a PRÓPRIA pessoa nas legendas, em vários idiomas.
 * Mapeados para o nome real ("Bernardo Belfort") na captura.
 */
const SELF_CAPTION_LABELS = new Set([
  'você', 'voce', 'you', 'eu', 'tu', 'me', 'myself', 'i',
]);

/** Deixa uma palavra como nome próprio: "JOÃO" → "João", "ana-maria" → "Ana-Maria". */
function capitalizeToken(word: string): string {
  const lower = word.toLocaleLowerCase('pt-BR');
  // Sobe a primeira letra de cada parte separada por hífen/apóstrofo/ponto.
  return lower.replace(
    /(^|[^\p{L}])(\p{L})/gu,
    (_match, boundary: string, letter: string) =>
      boundary + letter.toLocaleUpperCase('pt-BR'),
  );
}

function formatWord(word: string, isFirst: boolean): string {
  const lower = word.toLocaleLowerCase('pt-BR');
  if (!isFirst && NAME_PARTICLES.has(lower)) return lower;
  return capitalizeToken(word);
}

/**
 * Normaliza um nome de falante para exibição: proper-case (nome próprio) e no
 * máximo os 3 primeiros nomes. "MARIA EDUARDA DA SILVA SANTOS" → "Maria
 * Eduarda da Silva". Idempotente — reaplicar não muda o resultado.
 */
export function formatSpeakerName(raw: string | null): string | null {
  const clean = sanitizeSpeakerName(raw);
  if (clean === null) return null;

  const words = clean.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let meaningful = 0;
  for (const word of words) {
    const isParticle = NAME_PARTICLES.has(word.toLocaleLowerCase('pt-BR'));
    if (!isParticle) {
      if (meaningful >= MAX_NAME_WORDS) break;
      meaningful += 1;
    }
    kept.push(word);
  }
  // Nunca termina num conector solto ("Ana de" → "Ana").
  while (
    kept.length > 1 &&
    NAME_PARTICLES.has(kept[kept.length - 1]!.toLocaleLowerCase('pt-BR'))
  ) {
    kept.pop();
  }

  const formatted = kept.map((word, index) => formatWord(word, index === 0)).join(' ');
  return formatted.length > 0 ? formatted : null;
}

/** O primeiro nome, já em nome próprio ("maria eduarda" → "Maria"). */
export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/).filter(Boolean)[0] ?? '';
  return capitalizeToken(first);
}

/** O Meet chamou a fala de "Você"/"You"/"Eu"? Então é a própria pessoa. */
export function isSelfCaptionLabel(name: string | null): boolean {
  if (name === null) return false;
  return SELF_CAPTION_LABELS.has(name.trim().toLocaleLowerCase('pt-BR'));
}
