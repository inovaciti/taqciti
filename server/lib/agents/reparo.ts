/**
 * Reparo: a afirmação que o Auditor reprovou volta UMA vez ao Leitor, com o
 * motivo, e ele escolhe — citar a fala que faltou, reescrever dizendo menos, ou
 * retirar. Só o que foi citado ou reescrito é conferido de novo.
 *
 * Existe desde 25/11/2026. Antes, a reprovada virava lacuna direto
 * (`generateStep.ts` explicava: refazer seria reler a reunião inteira por
 * causa de um cargo). Numa reunião real isso esvaziou a Ata: a maior parte das
 * reprovações não era afirmação falsa, era citação faltando — o combinado
 * citado sem o "perfeito" de quem aceitou, a sexta-feira sem a fala do "dia
 * 27", a atuação provada pela fala de apresentação. Lacuna para isso é jogar
 * fora o que a reunião disse. O custo é uma chamada do Leitor (a transcrição
 * vai como prefixo de cache) e uma do Auditor, só quando houve reprovação.
 *
 * O que o reparo NÃO pode: tocar no que o código decidiu (concordância de
 * decisão que não existe, `blocker`), reescrever nome, dono ou prazo
 * (participante e encaminhamento só aceitam `citar`), e passar sem nova
 * conferência — tudo que ele mexe volta ao Auditor e às guardas.
 */
import { complete, type CompletionResult, type JsonSchema } from '../ai';
import { renderPrompt, versaoDoPrompt } from '../prompts';
import { anchorQuotes, type AnchoredQuote, type DocumentData } from '../documentData';
import { createLocator } from './anchoring';

export type AcaoDeReparo = 'citar' | 'reescrever' | 'retirar';

export interface ItemAReparar {
  path: string;
  /** A afirmação como o Auditor a leu. */
  texto: string;
  motivo: string;
}

export interface ReparoAplicado {
  path: string;
  acao: AcaoDeReparo;
}

export interface RepararResult {
  /** Paths citados ou reescritos: precisam de nova conferência. */
  aConferir: Set<string>;
  aplicados: ReparoAplicado[];
  meta?: CompletionResult['meta'];
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

/** Onde, nos dados, mora a afirmação de um path — e se o texto dela pode mudar. */
interface Alvo {
  quotes: AnchoredQuote[];
  compartilhadas?: boolean;
  /** Ausente = só `citar` (nome, dono e prazo não se reescrevem). */
  trocarTexto?: (novo: string) => void;
}

function alvoDoPath(data: DocumentData, path: string): Alvo | null {
  let m = /^(executiveSummary|outcomes|outputs|openPoints|decisions)\[(\d+)\]$/.exec(path);
  if (m) {
    const item = (data[m[1] as 'executiveSummary'] ?? [])[Number(m[2])];
    return item ? { quotes: item.quotes, trocarTexto: (novo) => (item.text = novo) } : null;
  }
  m = /^participants\[(\d+)\](\.atuacao|\.role)?$/.exec(path);
  if (m) {
    const p = (data.participants ?? [])[Number(m[1])];
    if (!p) return null;
    // As citações do participante provam presença E atuação: nunca se
    // substituem, só se acrescentam (`compartilhadas`).
    // A afirmação é "Na reunião, <nome> <atuação>", e o Leitor às vezes devolve
    // a frase inteira: sem tirar o começo, saía "Ana Souza Ana Souza pediu…".
    const semNome = (novo: string) => {
      let t = novo.replace(/^na reuni[aã]o,?\s*/i, '');
      if (t.toLowerCase().startsWith(p.name.toLowerCase())) t = t.slice(p.name.length).trim();
      return t;
    };
    // Nome e cargo não se reescrevem (`.role`: só citar a fala do cargo).
    return m[2] === '.atuacao'
      ? { quotes: p.quotes, compartilhadas: true, trocarTexto: (novo) => (p.atuacao = semNome(novo)) }
      : { quotes: p.quotes, compartilhadas: true };
  }
  m = /^actionItems\[(\d+)\]$/.exec(path);
  if (m) {
    const item = (data.actionItems ?? [])[Number(m[1])];
    return item ? { quotes: item.quotes } : null;
  }
  // Trecho do Resumo: reescrever tira o detalhe sem fala e salva o resto do
  // trecho (26/11/2026: três de seis trechos caíam por um detalhe cada).
  m = /^periods\[(\d+)\]$/.exec(path);
  if (m) {
    const item = (data.periods ?? [])[Number(m[1])];
    return item ? { quotes: item.quotes, trocarTexto: (novo) => (item.summary = novo.replace(/^na reuni[aã]o foi tratado \([^)]*\):\s*/i, '')) } : null;
  }
  m = /^generic\.(.+)\[(\d+)\]$/.exec(path);
  if (m) {
    const item = (data.generic?.[m[1]!] ?? [])[Number(m[2])];
    return item ? { quotes: item.quotes, trocarTexto: (novo) => (item.text = novo) } : null;
  }
  return null;
}

const ETIQUETA =
  /^(foi decidido na reuni[aã]o|ficou combinado na reuni[aã]o|ficou em aberto ao fim da reuni[aã]o[^:]*|algu[eé]m levantou na reuni[aã]o, e ficou sem resposta):\s*/i;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          acao: { type: 'string', enum: ['citar', 'reescrever', 'retirar'] },
          texto: { type: 'string', description: 'Só em `reescrever`; vazio nos outros casos.' },
          quotes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Citações LITERAIS, copiadas da transcrição caractere por caractere.',
          },
        },
        required: ['id', 'acao', 'texto', 'quotes'],
      },
    },
  },
  required: ['itens'],
};

/**
 * Pede o reparo e o aplica em `data`, no lugar. Devolve os paths que precisam
 * voltar ao Auditor; os que o Leitor retirou (ou não respondeu) continuam
 * reprovados e caem como antes.
 */
export async function reparar(
  data: DocumentData,
  itens: ItemAReparar[],
  transcript: string,
): Promise<RepararResult> {
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const aConferir = new Set<string>();
  const aplicados: ReparoAplicado[] = [];

  const comAlvo = itens
    .map((item, i) => ({ id: `r${i + 1}`, item, alvo: alvoDoPath(data, item.path) }))
    .filter((x): x is { id: string; item: ItemAReparar; alvo: Alvo } => x.alvo !== null);
  if (comAlvo.length === 0) return { aConferir, aplicados, usage };

  const pedido = comAlvo
    .map(({ id, item, alvo }) =>
      [
        `# ${id}`,
        '',
        `Afirmação: ${item.texto}`,
        `Citações dadas: ${alvo.quotes.map((q) => `"${q.quote}"`).join(' | ') || '(nenhuma)'}`,
        `Motivo da reprovação: ${item.motivo}`,
        `Pode reescrever: ${alvo.trocarTexto ? 'sim' : 'não — só citar ou retirar'}`,
      ].join('\n'),
    )
    .join('\n\n');

  const result = await complete('leitor', {
    system: renderPrompt('reparo', versaoDoPrompt('reparo')),
    messages: [{ role: 'user', content: pedido }],
    maxTokens: 4_000 + comAlvo.length * 600,
    jsonSchema: SCHEMA,
    cacheablePrefix: transcript,
    reasoning: 'medium',
  });
  usage.inputTokens += result.usage.inputTokens;
  usage.outputTokens += result.usage.outputTokens;
  usage.cachedInputTokens += result.usage.cachedInputTokens ?? 0;

  const respostas = new Map<string, { acao?: unknown; texto?: unknown; quotes?: unknown }>();
  const lista = ((result.parsed ?? {}) as { itens?: unknown }).itens;
  for (const r of Array.isArray(lista) ? lista : []) {
    const id = (r as { id?: unknown })?.id;
    if (typeof id === 'string' && !respostas.has(id)) respostas.set(id, r as never);
  }

  // Um localizador por item: as citações novas de cada um vêm em ordem própria.
  for (const { id, item, alvo } of comAlvo) {
    const r = respostas.get(id);
    const acao = r?.acao;
    if (acao !== 'citar' && acao !== 'reescrever') continue;
    const locate = createLocator(transcript);
    const novas = anchorQuotes(r?.quotes, (q) => locate.locate(q)).filter((q) => q.anchor !== null);

    if (acao === 'reescrever') {
      // A etiqueta é do sistema (`claims` a acrescenta); devolvida junto, sairia dobrada.
      const texto = typeof r?.texto === 'string' ? r.texto.replace(ETIQUETA, '').trim() : '';
      if (!alvo.trocarTexto || !texto || novas.length === 0) continue;
      alvo.trocarTexto(texto);
      // A prova do texto novo são as citações novas; as antigas, que o Auditor
      // já leu e reprovou, ficam junto só se o Leitor as repetiu.
      if (!alvo.compartilhadas) alvo.quotes.splice(0, alvo.quotes.length, ...novas);
      else {
        const ja = new Set(alvo.quotes.map((q) => q.quote));
        alvo.quotes.push(...novas.filter((q) => !ja.has(q.quote)));
      }
    } else {
      if (novas.length === 0) continue;
      const ja = new Set(alvo.quotes.map((q) => q.quote));
      alvo.quotes.push(...novas.filter((q) => !ja.has(q.quote)));
    }
    aConferir.add(item.path);
    aplicados.push({ path: item.path, acao });
  }

  return { aConferir, aplicados, meta: result.meta, usage };
}
