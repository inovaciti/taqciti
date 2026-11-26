/**
 * PONTO ÚNICO DE TROCA da geração. É aqui que o pipeline encosta no contrato
 * de `/api/generate`.
 *
 * Contrato pensado pra chunking: cada chamada pode devolver UMA seção (ou
 * um lote) com `done: false`, e quem chama laça até `done: true`,
 * acumulando em `completed` e repassando `answers` de perguntas já
 * respondidas. Esta implementação faz tudo numa PASSADA SÓ — devolve as
 * seções que faltam e `done: true` — mas `completed` é respeitado de
 * verdade: seção que já veio pronta não é regerada.
 *
 * O pipeline, inteiro:
 *
 *   1. Leitor   — UMA chamada: transcrição → dados de todas as seções;
 *   2. código   — âncora das citações, lacunas, rejeição sem evidência;
 *   3. Auditor  — UMA chamada: as afirmações das seções `strict`, cada uma
 *                 contra o próprio trecho;
 *   4. código   — rejeitada sai do documento e vira lacuna; o markdown, o
 *                 HTML e o PDF são montados dos dados.
 *
 * Eram de 20 a 30 chamadas (9 Pensante + ~11 Auditor + 6 Escritor), e agora
 * são duas. O que saiu era compensação por limitação que o modelo não tem
 * mais — ver `agents/leitor.ts` para o porquê de cada corte.
 *
 * Segunda passada: de 23/09 a 25/11/2026 não houve — a afirmação rejeitada
 * virava lacuna direto, porque refazer seria reler a reunião inteira por causa
 * de um cargo. Voltou como REPARO (`agents/reparo.ts`), uma chamada do Leitor
 * só com as reprovadas e o motivo, mais uma do Auditor só com o que mudou: numa
 * reunião real a maior parte das reprovações era citação faltando, não
 * afirmação falsa, e a lacuna esvaziava a Ata. Com prompt cache a releitura
 * custa pouco. Sem reprovação, continuam duas chamadas.
 */
import type { DocumentType } from './documentTypes';
import { TEMPLATES } from './templates';
import type { SectionSpec } from './templates/types';
import { soDuvidasExtremas, specForSection, type DocumentData, type Gap } from './documentData';
import { guardarFidelidade } from './guardaDeFidelidade';
export type { DocumentData, Gap };
import { detectGaps, ler, type SecaoLida } from './agents/leitor';
import { auditar, type AuditVerdict } from './agents/auditor';
import { reparar, type ReparoAplicado } from './agents/reparo';
import { completar } from './agents/completude';
import { ehRotuloDeSelf } from './rotuloDeSelf';
import { assertSemVazamento, confidenceFor, marcadorDeLacuna } from './vazamento';
import type { CompletionUsage } from './ai';

export type SectionConfidence = 'ok' | 'partial' | 'missing';

export interface RenderedSection {
  id: string;
  title: string;
  content: string;
  confidence: SectionConfidence;
}

export interface Question {
  id: string;
  sectionId: string;
  question: string;
  why: string;
  suggestions?: string[];
  optional: boolean;
}

export interface Answer {
  questionId: string;
  answer: string;
}

export interface GenerateStepInput {
  transcript: string;
  documentType: DocumentType;
  /** Seções já prontas de passadas anteriores. Não são regeradas. */
  completed: RenderedSection[];
  /** Respostas a perguntas de passadas anteriores. Não se pergunta duas vezes. */
  answers: Answer[];
  /**
   * O `documentData` que a passada anterior devolveu.
   *
   * Contraparte de expor `documentData` no resultado, e é o que faz o
   * contrato de chunking funcionar de verdade: sem isto, uma segunda chamada
   * recomeçaria com o acumulado vazio e o Leitor não veria nada do que já foi
   * determinado.
   */
  documentData?: DocumentData;
}

/** Rejeitada pelo Auditor — fora do documento, virou lacuna. */
export interface DiscardedClaim {
  sectionId: string;
  path: string;
  text: string;
  reason: string;
}

/** O que a geração gastou e como as citações se saíram. Para o relatório. */
export interface GenerateStepReport {
  usage: Required<CompletionUsage>;
  /** Chamadas a modelo nesta passada: Leitor, completude (se o tipo tem decisões/encaminhamentos/pendências), Auditor, e +2 por rodada de reparo (até `RODADAS_DE_REPARO`). */
  calls: number;
  porSecao: SecaoLida[];
  /** O veredito FINAL de cada afirmação (o da segunda conferência, se houve reparo). */
  verdicts: (AuditVerdict & { sectionId: string })[];
  discarded: DiscardedClaim[];
  /** O que o reparo fez com as reprovadas. Vazio quando nada foi reprovado. */
  reparos?: ReparoAplicado[];
  /** Quantos itens a passada de completude acrescentou, por lista. */
  completados?: Partial<Record<'decisions' | 'actionItems' | 'openPoints', number>>;
}

export interface GenerateStepResult {
  sections: RenderedSection[];
  questions: Question[];
  /**
   * O JSON intermediário acumulado. É a camada canônica: HTML e PDF
   * renderizam DAQUI — o markdown já perdeu que Maria tem cargo de origem
   * `meeting` e que a decisão tem concordância ancorada.
   */
  documentData: DocumentData;
  /** As lacunas, com o campo que cada uma ocupa. Quem renderiza precisa do
   *  campo para pôr o marcador no lugar certo. */
  gaps: Gap[];
  done: boolean;
  report: GenerateStepReport;
}

/**
 * A tela de perguntas não existe e **não bloqueia nada**. As perguntas voltam
 * populadas para quando ela existir; enquanto isso, a lacuna aparece marcada
 * dentro do próprio documento.
 */
function questionFor(gap: Gap, required: boolean): Question {
  return {
    id: `${gap.sectionId}:${gap.field}`,
    sectionId: gap.sectionId,
    question: gap.question,
    why: gap.why,
    optional: !required,
  };
}

/**
 * Afirmação descartada vira lacuna: o documento precisa mostrar que ali
 * FALTA algo, e não que ali não havia nada. São coisas diferentes para quem
 * lê a ata depois.
 */
function discardedAsGap(item: DiscardedClaim): Gap {
  return {
    sectionId: item.sectionId,
    field: item.path,
    question:
      `A afirmação "${item.text}" não foi confirmada pela transcrição. ` +
      'Ela deve constar na ata? Se sim, com que redação?',
    why: `Rejeitada na conferência contra o trecho original: ${item.reason}`,
  };
}

/**
 * A lacuna que o markdown da seção não pôs no lugar dela vai para o fim.
 *
 * O fim é pior que o lugar certo, e é de propósito que não se tenta adivinhar
 * onde inserir: lacuna no fim continua visível, lacuna colada no parágrafo
 * errado vira afirmação errada.
 */
function comLacunas(texto: string, gaps: Gap[]): string {
  const faltando = gaps.filter((gap) => !texto.includes(marcadorDeLacuna(gap)));
  if (faltando.length === 0) return texto;
  return `${texto}\n\n${faltando.map(marcadorDeLacuna).join('\n\n')}`.trim();
}

const MOTIVO_IMPESSOAL =
  'Redação: a ata é impessoal e esta frase traz nome de pessoa. Use `reescrever`: a mesma ' +
  'informação, sem o nome e com o mesmo grau de certeza ("considerou-se possível", "foi ' +
  'solicitado", "foi informado que"; "o cliente" ou "a equipe" quando o lado importar). ' +
  'Não retire, e dê de novo as citações que sustentam a frase.';

/** Os nomes dos participantes, para achar frase pessoal numa seção impessoal. */
function regexDosNomes(data: DocumentData): RegExp | null {
  const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const partes = new Set<string>();
  for (const p of data.participants ?? []) {
    for (const parte of p.name.replace(/[()]/g, ' ').split(/\s+/)) {
      if (parte.length >= 3 && !PARTICULAS.has(parte.toLowerCase()) && !ehRotuloDeSelf(parte)) partes.add(parte);
    }
  }
  if (partes.size === 0) return null;
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}])(${[...partes].map(escapar).join('|')})(?![\\p{L}])`, 'u');
}

/** Rodadas de reparo + reconferência. Cada uma custa 2 chamadas, e só acontece se sobrou reprovada mexível. */
export const RODADAS_DE_REPARO = 2;

export interface ApurarInput {
  transcript: string;
  /** Em ordem. */
  sections: SectionSpec[];
  known: DocumentData;
  answers: Answer[];
}

export interface ApurarResult {
  data: DocumentData;
  /** Lacunas por seção, já contando as afirmações descartadas. */
  gapsPorSecao: Map<string, Gap[]>;
  report: GenerateStepReport;
}

/**
 * Os passos 1 a 4 sem a montagem do markdown: dados apurados, conferidos e
 * limpos. Separado para a rota de diagnóstico (`/api/ai/secao`) exercitar
 * exatamente o mesmo caminho da geração, e não uma cópia dele.
 */
export async function apurar(input: ApurarInput): Promise<ApurarResult> {
  const pendentes = input.sections;
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const somar = (u: CompletionUsage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cachedInputTokens += u.cachedInputTokens ?? 0;
  };
  let calls = 0;

  // 1. Uma leitura da reunião.
  const lido = await ler({
    transcript: input.transcript,
    sections: pendentes,
    known: input.known,
    answers: input.answers,
  });
  somar(lido.usage);
  if (lido.meta) calls += 1;
  const data = lido.data;

  // 1b. "O que falta?" — decisões, encaminhamentos e pendências que a leitura
  // esqueceu. Só acrescenta; o acrescentado passa pelas mesmas guardas e pelo
  // Auditor. Ver `agents/completude.ts`.
  const completude = await completar({ transcript: input.transcript, sections: pendentes, data });
  somar(completude.usage);
  if (completude.meta) calls += 1;

  // Antes do Auditor e sem chamar modelo: frase com cargo ou gravidade que a
  // reunião não traz, ou que afirma como certo o que foi hipótese, sai daqui.
  // Ver `guardaDeFidelidade.ts` para o porquê de cada regra.
  const descartesDeFidelidade = guardarFidelidade(data, input.transcript);

  // 2–3. Uma conferência das afirmações que custam caro errar.
  const strict = pendentes.filter((section) => section.audit === 'strict');
  const afirmacoes = strict.flatMap((section) =>
    specForSection(section)
      .claims(data, section.id)
      .map((claim) => ({ section, claim })),
  );

  const audit = await auditar({
    claims: afirmacoes.map(({ claim }) => claim),
    transcript: input.transcript,
  });
  somar(audit.usage);
  calls += audit.calls.length;

  // 3b. Reparo: a reprovada volta ao Leitor com o motivo (cita o que faltou,
  // diz menos, ou retira), e o que ele mexeu volta ao Auditor. O que o código
  // reprovou (`blocker`) não entra. Ver `agents/reparo.ts`.
  //
  // Até `RODADAS_DE_REPARO` rodadas, e só com o que AINDA está reprovado e foi
  // mexido na rodada anterior (26/11/2026): numa reunião real, uma decisão
  // correta caía porque a releitura do Auditor errava — "tal parte não está
  // marcada", e estava — e uma segunda resposta ao motivo novo a salvava.
  const porPath = new Map(audit.verdicts.map((v) => [v.path, v]));

  // 3a. Estilo: frase APROVADA de seção impessoal que traz nome de participante
  // vai ao reparo para perder o nome (26/11/2026: a instrução sozinha deixava
  // escapar "Fulano disse acreditar ser possível"). É só redação — se o reparo
  // não reescrever, ou a reescrita não passar no Auditor, volta a frase original.
  const nomes = regexDosNomes(data);
  const soEstilo = new Map<string, AuditVerdict>();
  if (nomes) {
    for (const { section, claim } of afirmacoes) {
      const v = porPath.get(claim.path);
      if (!section.impessoal || claim.blocker || !v?.supported) continue;
      if (!nomes.test(claim.text.replace(/; [^;]+ assumiu a tarefa/, ''))) continue;
      soEstilo.set(claim.path, v);
      porPath.set(claim.path, { ...v, supported: false, reason: MOTIVO_IMPESSOAL });
    }
  }
  const antesDoEstilo: DocumentData = soEstilo.size ? structuredClone(data) : {};

  let reparos: ReparoAplicado[] = [];
  let candidatas = new Set(afirmacoes.filter(({ claim }) => !claim.blocker).map(({ claim }) => claim.path));
  for (let rodada = 0; rodada < RODADAS_DE_REPARO; rodada += 1) {
    const aReparar = afirmacoes
      .filter(({ claim }) => candidatas.has(claim.path) && porPath.get(claim.path)?.supported === false)
      .map(({ claim }) => ({ path: claim.path, texto: claim.text, motivo: porPath.get(claim.path)!.reason }));
    if (aReparar.length === 0) break;
    const reparo = await reparar(data, aReparar, input.transcript);
    somar(reparo.usage);
    if (reparo.meta) calls += 1;
    reparos = [...reparos, ...reparo.aplicados];
    if (reparo.aConferir.size === 0) break;
    const deNovo = strict
      .flatMap((section) => specForSection(section).claims(data, section.id))
      .filter((claim) => reparo.aConferir.has(claim.path));
    const conferencia = await auditar({ claims: deNovo, transcript: input.transcript });
    somar(conferencia.usage);
    calls += conferencia.calls.length;
    for (const v of conferencia.verdicts) porPath.set(v.path, v);
    // O texto reescrito é o que vai para o documento e para a conferência.
    for (const a of afirmacoes) {
      const nova = deNovo.find((c) => c.path === a.claim.path);
      if (nova) a.claim = nova;
    }
    candidatas = reparo.aConferir;
  }
  // Estilo que não se resolveu: a frase original, aprovada, volta como estava.
  for (const [path, original] of soEstilo) {
    if (porPath.get(path)?.supported) continue;
    const m = /^(\w+)\[(\d+)\]$/.exec(path);
    const lista = m ? (antesDoEstilo as Record<string, unknown[]>)[m[1]!] : undefined;
    if (m && lista?.[Number(m[2])] !== undefined) (data as Record<string, unknown[]>)[m[1]!]![Number(m[2])] = lista[Number(m[2])];
    porPath.set(path, original);
  }
  const vereditosFinais = audit.verdicts.map((v) => porPath.get(v.path) ?? v);

  // O path é único entre seções (`participants[0]`, `decisions[0]`,
  // `generic.<seção>[0]`), então ele basta para devolver cada veredito à sua.
  const secaoDoPath = new Map(afirmacoes.map(({ section, claim }) => [claim.path, section.id]));
  const verdicts = vereditosFinais.map((v) => ({ ...v, sectionId: secaoDoPath.get(v.path) ?? '' }));

  // 4. Rejeitada sai do documento e vira lacuna.
  const rejeitadas = new Set(vereditosFinais.filter((v) => !v.supported).map((v) => v.path));
  const discarded: DiscardedClaim[] = descartesDeFidelidade.map((d) => ({
    sectionId: d.sectionId,
    path: d.path,
    text: d.texto,
    reason: d.motivo,
  }));
  const descartadasPorSecao = new Map<string, DiscardedClaim[]>();

  for (const { section, claim } of afirmacoes) {
    if (!rejeitadas.has(claim.path)) continue;
    const verdict = porPath.get(claim.path)!;
    const item = { sectionId: section.id, path: claim.path, text: claim.text, reason: verdict.reason };
    discarded.push(item);
    descartadasPorSecao.set(section.id, [...(descartadasPorSecao.get(section.id) ?? []), item]);
  }
  for (const section of strict) {
    const paths = new Set((descartadasPorSecao.get(section.id) ?? []).map((d) => d.path));
    if (paths.size > 0) specForSection(section).drop(data, paths, section.id);
  }

  // Texto reescrito no reparo passa pelas mesmas guardas de fidelidade que o
  // original passou. DEPOIS do descarte: as guardas também tiram itens, e os
  // paths do Auditor são por índice.
  if (reparos.some((r) => r.acao === 'reescrever')) {
    for (const d of guardarFidelidade(data, input.transcript)) {
      discarded.push({ sectionId: d.sectionId, path: d.path, text: d.texto, reason: d.motivo });
    }
  }

  // Lacuna calculada DEPOIS do descarte: o participante rejeitado não pode
  // deixar para trás uma pergunta sobre o cargo dele.
  //
  // E só a dúvida EXTREMA sobrevive: o documento sai sem campo "[A preencher]"
  // para cargo, assinatura, nome do projeto ou afirmação descartada — o campo
  // simplesmente não entra, e ninguém recebe pergunta por isso.
  const gapsPorSecao = new Map<string, Gap[]>();
  for (const section of pendentes) {
    gapsPorSecao.set(
      section.id,
      soDuvidasExtremas([
        ...detectGaps(section, data),
        ...(descartadasPorSecao.get(section.id) ?? []).map(discardedAsGap),
      ]),
    );
  }

  return {
    data,
    gapsPorSecao,
    report: { usage, calls, porSecao: lido.porSecao, verdicts, discarded, reparos, completados: completude.acrescentados },
  };
}

export async function generateStep(input: GenerateStepInput): Promise<GenerateStepResult> {
  const template = TEMPLATES[input.documentType];

  const jaPronta = new Set(input.completed.map((s) => s.id));
  const pendentes: SectionSpec[] = template.sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((section) => !jaPronta.has(section.id));

  const { data, gapsPorSecao, report } = await apurar({
    transcript: input.transcript,
    sections: pendentes,
    known: input.documentData ?? {},
    answers: input.answers,
  });

  const sections: RenderedSection[] = [];
  const questions: Question[] = [];
  const gaps: Gap[] = [];

  for (const section of pendentes) {
    const spec = specForSection(section);
    const daSecao = gapsPorSecao.get(section.id) ?? [];

    gaps.push(...daSecao);
    for (const gap of daSecao) questions.push(questionFor(gap, section.required));

    const dados = spec.serialize(data, section.id);
    // Seção marcada para sumir e sem dado nenhum: some. Aparecer com título e
    // nada embaixo diria ao leitor que a reunião não produziu isto, quando o
    // que houve foi não haver o que registrar.
    if (dados === null && section.omitWhenEmpty) continue;

    const content = comLacunas(spec.markdown(data, section, daSecao), daSecao);
    assertSemVazamento(content, `a seção "${section.title}"`);

    sections.push({
      id: section.id,
      title: section.title,
      content,
      confidence: confidenceFor(section, dados, daSecao),
    });
  }

  // Guarda final sobre o documento MONTADO. As seções já foram conferidas uma
  // a uma; esta pega o que só existe na junção — e custa uma varredura de
  // string contra a possibilidade de a instrução do PDF chegar num cliente.
  assertSemVazamento(
    [...input.completed, ...sections].map((s) => s.content).join('\n\n'),
    'o documento montado',
  );

  return { sections, questions, documentData: data, gaps, done: true, report };
}
