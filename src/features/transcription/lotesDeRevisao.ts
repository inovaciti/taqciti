/**
 * A revisão da transcrição em LOTES — a parte pura, sem rede nem storage.
 *
 * Por que lotes (25/11/2026): a revisão ia numa chamada só, com a reunião
 * inteira. Numa reunião real de 26 minutos (77 falas, 23 mil caracteres) a
 * chamada levou 42 s — a extensão desistia em 25 s — e voltou 502, porque a
 * saída (a transcrição inteira reescrita) passava do teto de 8192 tokens. Uma
 * reunião de uma hora nem era tentada (teto de 40 mil caracteres). Ou seja: a
 * revisão nunca funcionava numa reunião de verdade, e calada.
 *
 * O contexto que a chamada única tentava preservar vai junto em cada lote: as
 * falas logo anteriores, marcadas como só leitura (`anteriores`).
 *
 * E a guarda em código (`revisaoSegura`): o modelo pode "corrigir" o que não
 * devia. Fala revisada que muda número, perde ou ganha negação, ou muda muito de
 * tamanho volta ao original. Ela é estreita de propósito: recusar uma correção
 * boa custa só o ruído que fica; aceitar uma ruim muda o que alguém disse.
 */

export interface FalaParaRevisar {
  id: string;
  pessoa?: string;
  texto: string;
}

export interface LoteDeRevisao {
  anteriores: { pessoa?: string; texto: string }[];
  falas: FalaParaRevisar[];
}

/** ~4 mil caracteres de fala por lote: saída de ~1,5 mil tokens, ~10 s no Haiku. */
export const CHARS_POR_LOTE = 4_000;
/**
 * Quanto da reunião ANTERIOR vai como contexto de cada lote. Eram 3 falas; em
 * 26/11/2026 isso não bastou: no fechamento, a legenda disse "fico no aguardo
 * aí data de reunião", e só quem leu o pedido de "uma ata com um resumo", 13
 * minutos antes, sabe que é "a ata da reunião". ~12 mil caracteres cobrem meia
 * hora de conversa e cabem com folga no teto de contexto do servidor.
 */
export const CHARS_DE_CONTEXTO = 12_000;
/** Fala maior que isto fica como veio: sozinha já estouraria o lote. */
export const MAX_CHARS_DA_FALA = 12_000;
/** Lotes ao mesmo tempo. Mais que isso esbarra na cota por minuto do provedor. */
export const CONCORRENCIA = 3;

export function montarLotes(falas: readonly FalaParaRevisar[]): LoteDeRevisao[] {
  const lotes: LoteDeRevisao[] = [];
  let atual: FalaParaRevisar[] = [];
  let tamanho = 0;
  let inicio = 0;

  const fechar = (fim: number) => {
    if (atual.length === 0) return;
    const anteriores: LoteDeRevisao['anteriores'] = [];
    let chars = 0;
    for (let j = inicio - 1; j >= 0; j -= 1) {
      const { pessoa, texto } = falas[j]!;
      if (texto.length > MAX_CHARS_DA_FALA) continue;
      if (chars + texto.length > CHARS_DE_CONTEXTO) break;
      anteriores.unshift({ ...(pessoa ? { pessoa } : {}), texto });
      chars += texto.length;
    }
    lotes.push({ anteriores, falas: atual });
    atual = [];
    tamanho = 0;
    inicio = fim;
  };

  falas.forEach((fala, i) => {
    if (fala.texto.length > MAX_CHARS_DA_FALA || !fala.texto.trim()) {
      fechar(i);
      inicio = i + 1;
      return;
    }
    if (tamanho + fala.texto.length > CHARS_POR_LOTE) fechar(i);
    if (atual.length === 0) inicio = i;
    atual.push(fala);
    tamanho += fala.texto.length;
  });
  fechar(falas.length);
  return lotes;
}

/** Saída pedida: o texto reescrito (~1 token a cada 2,5 caracteres em pt) e o JSON em volta. */
export function tokensDeSaidaPara(lote: LoteDeRevisao): number {
  const chars = lote.falas.reduce((n, f) => n + f.texto.length + f.id.length + 20, 0);
  return Math.min(8_192, Math.max(512, Math.ceil(chars / 2.5) + 400));
}

const NEGACAO = /(^|[^\p{L}])(não|nao|nunca|nem|jamais|nenhum|nenhuma|ninguém|ninguem)(?=$|[^\p{L}])/iu;
const numeros = (t: string) => (t.match(/\d+/g) ?? []).sort().join(',');

/** A fala revisada pode substituir a original? */
export function revisaoSegura(original: string, revisado: string): boolean {
  const o = original.trim();
  const r = revisado.trim();
  if (!r) return false;
  if (numeros(o) !== numeros(r)) return false;
  if (NEGACAO.test(o) !== NEGACAO.test(r)) return false;
  if (o.length >= 30) {
    const razao = r.length / o.length;
    if (razao < 0.5 || razao > 1.6) return false;
  } else if (r.length > o.length * 2 + 20) return false;
  return true;
}

/**
 * Lê a resposta de um lote. `null` quando ela não serve inteira: id faltando,
 * fora de ordem ou a mais — um lote pela metade não se aproveita, porque não
 * dá para saber qual fala ficou com o texto de qual.
 */
export function lerRespostaDoLote(lote: LoteDeRevisao, texto: string): Map<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  const falas = (parsed as { falas?: unknown })?.falas;
  if (!Array.isArray(falas) || falas.length !== lote.falas.length) return null;
  const saida = new Map<string, string>();
  for (let i = 0; i < falas.length; i += 1) {
    const f = falas[i] as { id?: unknown; texto?: unknown };
    if (f?.id !== lote.falas[i]!.id || typeof f.texto !== 'string') return null;
    if (revisaoSegura(lote.falas[i]!.texto, f.texto)) saida.set(f.id, f.texto.trim());
  }
  return saida;
}

/**
 * Revisa todos os lotes, `CONCORRENCIA` por vez, com uma nova tentativa por
 * lote. Devolve o texto revisado de cada fala aceita; o que falhou fica de fora
 * (e a fala continua como veio).
 */
export async function revisarEmLotes(
  falas: readonly FalaParaRevisar[],
  chamar: (lote: LoteDeRevisao) => Promise<string | null>,
  concorrencia = CONCORRENCIA,
): Promise<{ revisadas: Map<string, string>; lotes: number; lotesFalhos: number }> {
  const lotes = montarLotes(falas);
  const revisadas = new Map<string, string>();
  let lotesFalhos = 0;
  let proximo = 0;

  const trabalhar = async () => {
    while (proximo < lotes.length) {
      const lote = lotes[proximo++]!;
      let lido: Map<string, string> | null = null;
      for (let tentativa = 0; tentativa < 2 && !lido; tentativa += 1) {
        try {
          const texto = await chamar(lote);
          lido = texto === null ? null : lerRespostaDoLote(lote, texto);
        } catch {
          lido = null;
        }
      }
      if (!lido) lotesFalhos += 1;
      else for (const [id, texto] of lido) revisadas.set(id, texto);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, lotes.length) }, trabalhar));
  return { revisadas, lotes: lotes.length, lotesFalhos };
}
