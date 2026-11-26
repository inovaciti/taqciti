import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * O reparo (25/11/2026) devolve ao Leitor o que o Auditor reprovou. O que
 * precisa estar certo é o que ele PODE mexer: citação nova só conta se existir
 * na transcrição; nome, dono e prazo não se reescrevem; a etiqueta do sistema
 * não sai dobrada; e o que foi citado ou reescrito volta para conferência.
 */
const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
}));

const { reparar } = await import('./reparo');
import type { DocumentData } from '../documentData';

const transcript = [
  '[00:10] Rui: Dá para mandar o relatório até quinta?',
  '[00:12] Você: Perfeito, mando sim.',
  '[00:20] Ana Souza: Isso eu preciso checar com o Otávio.',
].join('\n');

const resposta = (itens: unknown[]) => ({
  text: '',
  parsed: { itens },
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
});

const dados = (): DocumentData => ({
  executiveSummary: [{ text: 'Ficou combinado o relatório até quinta, aprovado pela diretoria.', quotes: [] }],
  actionItems: [{ acao: 'Enviar o relatório', prazo: 'até quinta', quotes: [] }],
  participants: [{ name: 'Ana Souza', roleSource: 'unknown', atuacao: 'decidiu tudo', quotes: [] }],
  openPoints: [{ text: 'Consulta ao Otávio.', quotes: [] }],
});

afterEach(() => complete.mockReset());

describe('reparar', () => {
  it('citar acrescenta só citação que existe, e manda reconferir', async () => {
    complete.mockResolvedValue(
      resposta([{ id: 'r1', acao: 'citar', texto: '', quotes: ['Perfeito, mando sim.', 'fala que não existe'] }]),
    );
    const data = dados();
    const r = await reparar(data, [{ path: 'actionItems[0]', texto: 'x', motivo: 'faltou o aceite' }], transcript);
    expect(data.actionItems![0]!.quotes.map((q) => q.quote)).toEqual(['Perfeito, mando sim.']);
    expect([...r.aConferir]).toEqual(['actionItems[0]']);
  });

  it('reescrever troca o texto e as citações, sem a etiqueta do sistema', async () => {
    complete.mockResolvedValue(
      resposta([
        { id: 'r1', acao: 'reescrever', texto: 'Ficou combinado na reunião: Enviar o relatório até quinta.', quotes: ['Dá para mandar o relatório até quinta?'] },
      ]),
    );
    const data = dados();
    await reparar(data, [{ path: 'executiveSummary[0]', texto: 'x', motivo: 'diretoria não foi dita' }], transcript);
    expect(data.executiveSummary![0]!.text).toBe('Enviar o relatório até quinta.');
    expect(data.executiveSummary![0]!.quotes.map((q) => q.quote)).toEqual(['Dá para mandar o relatório até quinta?']);
  });

  it('atuação reescrita perde o "Na reunião, <nome>" e não apaga a prova de presença', async () => {
    complete.mockResolvedValue(
      resposta([{ id: 'r1', acao: 'reescrever', texto: 'Na reunião, Ana Souza ficou de consultar o Otávio', quotes: ['Isso eu preciso checar com o Otávio.'] }]),
    );
    const data = dados();
    data.participants![0]!.quotes = [{ quote: 'Rui', anchor: { start: 8, end: 11, exact: true } }];
    await reparar(data, [{ path: 'participants[0].atuacao', texto: 'x', motivo: 'não decidiu nada' }], transcript);
    expect(data.participants![0]!.atuacao).toBe('ficou de consultar o Otávio');
    expect(data.participants![0]!.quotes).toHaveLength(2);
  });

  it('encaminhamento: a ação se reescreve, o dono não (nem enfiado no texto); retirar e sem resposta não mudam nada', async () => {
    complete.mockResolvedValue(
      resposta([
        { id: 'r1', acao: 'reescrever', texto: 'Enviar o relatório; Rui assumiu', quotes: ['Perfeito, mando sim.'] },
        { id: 'r2', acao: 'retirar', texto: '', quotes: [] },
      ]),
    );
    const data = dados();
    const r = await reparar(
      data,
      [
        { path: 'actionItems[0]', texto: 'x', motivo: 'm' },
        { path: 'openPoints[0]', texto: 'x', motivo: 'm' },
        { path: 'executiveSummary[0]', texto: 'x', motivo: 'm' },
      ],
      transcript,
    );
    // Desde 26/11/2026 a ação se reescreve (ata impessoal), mas "Rui assumiu"
    // dentro do texto é dono contrabandeado: sai, e o campo responsável não muda.
    expect(data.actionItems![0]!.acao).toBe('Enviar o relatório');
    expect(data.actionItems![0]!.responsavel).toBeUndefined();
    expect([...r.aConferir]).toEqual(['actionItems[0]']);
    expect(complete.mock.calls[0]![1].messages[0].content).toContain('Pode reescrever: sim');
  });

  it('nada a reparar: nenhuma chamada', async () => {
    const r = await reparar(dados(), [{ path: 'desconhecido[0]', texto: 'x', motivo: 'm' }], transcript);
    expect(complete).not.toHaveBeenCalled();
    expect(r.aplicados).toEqual([]);
  });
});
