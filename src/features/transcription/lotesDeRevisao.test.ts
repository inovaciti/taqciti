import { describe, expect, it, vi } from 'vitest';
import {
  CHARS_DE_CONTEXTO,
  CHARS_POR_LOTE,
  MAX_CHARS_DA_FALA,
  lerRespostaDoLote,
  montarLotes,
  revisaoSegura,
  revisarEmLotes,
  tokensDeSaidaPara,
  type FalaParaRevisar,
} from './lotesDeRevisao';

/**
 * A revisão em lotes existe porque a chamada única nunca chegava ao fim numa
 * reunião real (25/11/2026: 77 falas, 42 s, 502). Aqui se fixa o que a
 * mantém fiel: cada lote leva as falas anteriores como contexto, um lote ruim
 * não contamina os outros, e a guarda recusa a "correção" que muda número ou
 * negação.
 */
const fala = (i: number, texto = 'x'.repeat(1_000)): FalaParaRevisar => ({ id: `c${i}`, pessoa: 'Ana', texto });

describe('montarLotes', () => {
  it('corta por tamanho e manda as falas anteriores como contexto', () => {
    const falas = Array.from({ length: 10 }, (_, i) => fala(i));
    const lotes = montarLotes(falas);
    expect(lotes.length).toBeGreaterThan(1);
    for (const l of lotes) expect(l.falas.reduce((n, f) => n + f.texto.length, 0)).toBeLessThanOrEqual(CHARS_POR_LOTE);
    // Todas as falas, uma vez, na ordem.
    expect(lotes.flatMap((l) => l.falas.map((f) => f.id))).toEqual(falas.map((f) => f.id));
    expect(lotes[0]!.anteriores).toEqual([]);
    // Todas as falas anteriores ao lote, em ordem, enquanto couberem.
    expect(lotes[1]!.anteriores).toHaveLength(lotes[0]!.falas.length);
    expect(lotes[1]!.anteriores.at(-1)!.texto).toBe(falas[lotes[0]!.falas.length - 1]!.texto);
  });

  it('o contexto anterior para no teto de caracteres, guardando as mais recentes', () => {
    const falas = Array.from({ length: 40 }, (_, i) => fala(i, `${i} ${'x'.repeat(995)}`));
    const ultimo = montarLotes(falas).at(-1)!;
    const chars = ultimo.anteriores.reduce((n, f) => n + f.texto.length, 0);
    expect(chars).toBeLessThanOrEqual(CHARS_DE_CONTEXTO);
    expect(ultimo.anteriores.length).toBeGreaterThan(5);
    const primeiraDoLote = Number(ultimo.falas[0]!.id.slice(1));
    expect(ultimo.anteriores.at(-1)!.texto.startsWith(`${primeiraDoLote - 1} `)).toBe(true);
  });

  it('fala gigante ou vazia fica de fora (continua como veio)', () => {
    const lotes = montarLotes([fala(1, 'oi'), fala(2, 'y'.repeat(MAX_CHARS_DA_FALA + 1)), fala(3, '  '), fala(4, 'tchau')]);
    expect(lotes.flatMap((l) => l.falas.map((f) => f.id))).toEqual(['c1', 'c4']);
  });

  it('pede saída proporcional ao lote, dentro do teto do servidor', () => {
    expect(tokensDeSaidaPara({ anteriores: [], falas: [fala(1, 'oi')] })).toBe(512);
    expect(tokensDeSaidaPara({ anteriores: [], falas: [fala(1, 'z'.repeat(40_000))] })).toBe(8_192);
  });
});

describe('revisaoSegura', () => {
  it('aceita pontuação e palavra trocada pelo reconhecimento de voz', () => {
    expect(revisaoSegura('Não não pode pode mandar isso no grupo até amanhã mesmo certo.', 'Não, pode mandar isso no grupo até amanhã mesmo, certo?')).toBe(true);
    expect(revisaoSegura('seria como se fosse um Cash que vai armazenar', 'seria como se fosse um cache que vai armazenar')).toBe(true);
  });

  it('recusa a que muda número, negação ou tamanho', () => {
    expect(revisaoSegura('a entrega fica para o dia 27', 'a entrega fica para o dia 28')).toBe(false);
    expect(revisaoSegura('a gente não vai entregar sexta', 'a gente vai entregar sexta')).toBe(false);
    expect(revisaoSegura('a gente vai entregar sexta', 'a gente não vai entregar sexta')).toBe(false);
    expect(revisaoSegura('a gente vai entregar na sexta e depois revisar tudo', 'entrega sexta')).toBe(false);
    expect(revisaoSegura('ok', '')).toBe(false);
  });
});

describe('lerRespostaDoLote', () => {
  const lote = { anteriores: [], falas: [fala(1, 'oi tudo bem'), fala(2, 'tudo certo')] };

  it('lote inteiro ou nada: id fora de ordem invalida', () => {
    expect(lerRespostaDoLote(lote, '{"falas":[{"id":"c2","texto":"a"},{"id":"c1","texto":"b"}]}')).toBeNull();
    expect(lerRespostaDoLote(lote, '{"falas":[{"id":"c1","texto":"a"}]}')).toBeNull();
    expect(lerRespostaDoLote(lote, 'não é json')).toBeNull();
  });

  it('a fala que a guarda recusa fica fora do mapa; as outras entram', () => {
    const lido = lerRespostaDoLote(lote, '```json\n{"falas":[{"id":"c1","texto":"Oi, tudo bem?"},{"id":"c2","texto":"não está tudo certo"}]}\n```');
    expect(lido).toEqual(new Map([['c1', 'Oi, tudo bem?']]));
  });
});

describe('revisarEmLotes', () => {
  it('um lote que falha duas vezes não leva os outros junto', async () => {
    const falas = Array.from({ length: 10 }, (_, i) => fala(i, `fala número ${'a'.repeat(900)} ${i}`));
    const lotes = montarLotes(falas);
    const chamar = vi.fn(async (lote: (typeof lotes)[number]) => {
      if (lote.falas[0]!.id === 'c0') throw new Error('provedor fora');
      return JSON.stringify({ falas: lote.falas.map((f) => ({ id: f.id, texto: f.texto })) });
    });
    const r = await revisarEmLotes(falas, chamar);
    expect(r.lotesFalhos).toBe(1);
    expect(r.lotes).toBe(lotes.length);
    expect(r.revisadas.has('c0')).toBe(false);
    expect(r.revisadas.has('c9')).toBe(true);
    // Uma nova tentativa no lote que falhou, e só nele.
    expect(chamar).toHaveBeenCalledTimes(lotes.length + 1);
  });
});
