/**
 * Completude: depois da leitura, o Leitor recebe o que já escreveu e responde
 * "o que a reunião combinou ou deixou em aberto que não está aqui?".
 *
 * Existe desde 26/11/2026. Medido contra o gabarito de uma reunião real, o que
 * o Leitor escrevia saía certo, mas a LEMBRANÇA variava de uma geração para
 * outra: na mesma transcrição, uma Ata trazia a decisão da entrega, "enviar a
 * ata" e o cronograma, e a seguinte esquecia os três (placar 19, 16, 15 de
 * 19). Uma leitura só, com o documento inteiro para escrever, deixa escapar
 * justamente os itens miúdos do fim da reunião. A segunda pergunta é estreita
 * — só três seções, só o que falta — e custa uma chamada do Leitor, com a
 * transcrição no prefixo de cache.
 *
 * O que ela acrescenta passa pelo MESMO caminho do resto: âncora em código,
 * guardas de fidelidade e Auditor. Ela só pode acrescentar, nunca mudar o que
 * já estava; o repetido (mesmo com outras palavras) é cortado aqui.
 */
import { complete, type CompletionResult } from '../ai';
import { renderPrompt, versaoDoPrompt } from '../prompts';
import type { SectionSpec } from '../templates/types';
import { specForSection, type DocumentData } from '../documentData';
import { createLocator } from './anchoring';
import { schemaDoDocumento } from './leitor';

/**
 * As seções onde a lembrança falha e a conferência pega o excesso.
 *
 * DECISÕES ficam de fora de propósito. Com elas, o gabarito sintético
 * (`ataResumo.live.test.ts`) falhou em 26/11/2026: uma decisão REVERTIDA mais
 * tarde na reunião parecia "faltando", e voltou. O Auditor não pega isso — a
 * reversão está longe das falas citadas. Decisão é a seção de maior peso
 * jurídico da Ata; para ela vale só a primeira leitura.
 */
export const SECOES_DE_COMPLETUDE = ['encaminhamentos', 'em_aberto', 'pontos_de_atencao'];

type Lista = 'actionItems' | 'openPoints';
const LISTA_DA_SECAO: Record<string, Lista> = {
  encaminhamentos: 'actionItems',
  em_aberto: 'openPoints',
  pontos_de_atencao: 'openPoints',
};

const textoDe = (item: { text?: string; acao?: string }) => item.text ?? item.acao ?? '';

function palavras(texto: string): Set<string> {
  return new Set(
    (texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]{4,}/g) ?? []),
  );
}

/** Já está registrado, com outras palavras? Metade ou mais das palavras de conteúdo em comum. */
export function jaRegistrado(novo: string, existentes: readonly string[]): boolean {
  const n = palavras(novo);
  if (n.size === 0) return true;
  return existentes.some((e) => {
    const x = palavras(e);
    const comuns = [...n].filter((p) => x.has(p)).length;
    return comuns / Math.min(n.size, x.size || 1) >= 0.5;
  });
}

export interface CompletarResult {
  /** Quantos itens entraram, por lista. */
  acrescentados: Partial<Record<Lista, number>>;
  meta?: CompletionResult['meta'];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

export async function completar(input: {
  transcript: string;
  sections: SectionSpec[];
  data: DocumentData;
}): Promise<CompletarResult> {
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const alvo = input.sections.filter((s) => SECOES_DE_COMPLETUDE.includes(s.id));
  if (alvo.length === 0) return { acrescentados: {}, usage };

  const pedido = [
    '# O que o documento já registra',
    '',
    ...alvo.flatMap((s) => [
      `## ${s.title} (chave \`${s.id}\`)`,
      '',
      specForSection(s).serialize(input.data, s.id) ?? '(nada registrado)',
      '',
      `Instrução da seção: ${s.guidance}`,
      '',
    ]),
    'Devolva, em cada chave, SÓ os itens que faltam.',
  ].join('\n');

  const result = await complete('leitor', {
    system: renderPrompt('completude', versaoDoPrompt('completude')),
    messages: [{ role: 'user', content: pedido }],
    maxTokens: 16_000,
    jsonSchema: schemaDoDocumento(alvo),
    cacheablePrefix: input.transcript,
    reasoning: 'high',
  });
  usage.inputTokens += result.usage.inputTokens;
  usage.outputTokens += result.usage.outputTokens;
  usage.cachedInputTokens += result.usage.cachedInputTokens ?? 0;

  const parsed = (result.parsed ?? {}) as Record<string, unknown>;
  const acrescentados: CompletarResult['acrescentados'] = {};
  for (const s of alvo) {
    const lista = LISTA_DA_SECAO[s.id]!;
    const novos: DocumentData = {};
    const locator = createLocator(input.transcript);
    specForSection(s).merge(novos, parsed[s.id], s.id, (q, perto) => locator.locate(q, perto));
    const existentes = (input.data[lista] ?? []) as { text?: string; acao?: string }[];
    const textos = existentes.map(textoDe);
    const entram = ((novos[lista] ?? []) as { text?: string; acao?: string }[]).filter((item) => {
      if (jaRegistrado(textoDe(item), textos)) return false;
      textos.push(textoDe(item));
      return true;
    });
    if (entram.length === 0) continue;
    (input.data as Record<Lista, unknown[]>)[lista] = [...existentes, ...entram];
    acrescentados[lista] = (acrescentados[lista] ?? 0) + entram.length;
  }
  return { acrescentados, meta: result.meta, usage };
}
