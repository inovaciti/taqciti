import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Presença decidida em CÓDIGO (25/11/2026). Numa reunião real o Auditor
 * reprovou a presença de quatro de cinco participantes, cada um com a própria
 * fala marcada. O rótulo da linha é a prova; o modelo não precisa opinar — e
 * não pode ser chamado para isso.
 */
const complete = vi.hoisted(() => vi.fn());
vi.mock('../ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai')>()),
  complete,
}));

const { auditar, falanteEm, rotuloEhDe } = await import('./auditor');

const transcript = [
  '[00:10] Ana Souzaana Souza: Boa tarde, pessoal.',
  'Vamos começar pela agenda.',
  '[00:20] Carlos Lima: Meu nome é Carlos.',
  '[00:30] Você: Eu conduzo hoje.',
].join('\n');
const ancora = (quote: string) => {
  const start = transcript.indexOf(quote);
  return { start, end: start + quote.length, exact: true };
};

afterEach(() => complete.mockReset());

describe('quem fala', () => {
  it('linha de continuação pertence ao último cabeçalho', () => {
    expect(falanteEm(transcript, transcript.indexOf('Vamos começar'))).toBe('Ana Souzaana Souza');
    expect(falanteEm(transcript, transcript.indexOf('Meu nome'))).toBe('Carlos Lima');
  });

  it('texto antes do primeiro cabeçalho não tem falante', () => {
    expect(falanteEm('Participantes: Ana\n[00:10] Ana: oi', 3)).toBeNull();
  });

  it('o rótulo duplicado pelo Meet ainda é da pessoa; outro nome que começa igual não é', () => {
    expect(rotuloEhDe('Ana Souzaana Souza', 'Ana Souza')).toBe(true);
    expect(rotuloEhDe('Carlos Lima Duartecarlos', 'Carlos Lima Duarte')).toBe(true);
    expect(rotuloEhDe('Ana Souza', 'Ana Souza')).toBe(true);
    expect(rotuloEhDe('Você', 'Você')).toBe(true);
    expect(rotuloEhDe('Anabela', 'Ana')).toBe(false);
    expect(rotuloEhDe('Carlos Lima', 'Ana Souza')).toBe(false);
  });

  it('"Rafael (Ana Souza)" — nome dito e conta do Meet — é de quem for chamado por qualquer dos dois', () => {
    expect(rotuloEhDe('Rafael (Ana Souza)', 'Rafael (Ana Souza)')).toBe(true);
    expect(rotuloEhDe('Rafael (Ana Souza)', 'Rafael')).toBe(true);
    expect(rotuloEhDe('Rafael (Ana Souza)', 'Ana Souza')).toBe(true);
    expect(rotuloEhDe('Rafael (Ana Souza)', 'Carlos Lima')).toBe(false);
  });
});

describe('auditar com presencaDe', () => {
  it('fala rotulada da pessoa aprova sem chamar o modelo', async () => {
    const { verdicts } = await auditar({
      transcript,
      claims: [
        { path: 'participants[0]', text: 'Ana Souza participou da reunião.', anchors: [ancora('Vamos começar pela agenda.')], presencaDe: 'Ana Souza' },
        { path: 'participants[1]', text: 'Você participou da reunião.', anchors: [ancora('Eu conduzo hoje.')], presencaDe: 'Você' },
      ],
    });
    expect(complete).not.toHaveBeenCalled();
    expect(verdicts.map((v) => v.supported)).toEqual([true, true]);
  });

  it('citação da fala de OUTRA pessoa vai ao modelo, como antes', async () => {
    complete.mockResolvedValue({
      text: '',
      parsed: { verdicts: [{ id: 'a1', reason: 'a fala é de Carlos', supported: false }] },
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      meta: { provider: 'google', model: 'falso', latencyMs: 1, repaired: false, rateLimitWaits: 0, overloadWaits: 0 },
    });
    const { verdicts } = await auditar({
      transcript,
      claims: [
        { path: 'participants[0]', text: 'Ana Souza participou da reunião.', anchors: [ancora('Meu nome é Carlos.')], presencaDe: 'Ana Souza' },
      ],
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(verdicts[0]!.supported).toBe(false);
  });
});
