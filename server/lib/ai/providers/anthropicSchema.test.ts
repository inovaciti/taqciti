/**
 * A saída estruturada da Anthropic exige `additionalProperties: false` em todo
 * objeto (400 na primeira execução real, 23/11/2026). O schema é compartilhado
 * com os outros provedores, então o ajuste é uma CÓPIA, feita só no adaptador.
 */
import { describe, expect, it } from 'vitest';
import { FOLGA_DE_RACIOCINIO, orcamentoDeSaida, schemaParaAnthropic } from './anthropic';

/**
 * Com raciocínio adaptativo, `max_tokens` conta raciocínio + resposta. O
 * Auditor (Haiku 5.5) pede 2000 + 500 por afirmação, pensando só na resposta;
 * sem folga o JSON dos vereditos podia sair cortado e derrubar a Ata inteira.
 */
describe('orcamentoDeSaida', () => {
  it('soma a folga de raciocínio nos modelos com raciocínio adaptativo', () => {
    expect(orcamentoDeSaida('claude-haiku-5-5', 4_500)).toBe(4_500 + FOLGA_DE_RACIOCINIO);
    expect(orcamentoDeSaida('claude-sonnet-5-5', 48_000)).toBe(48_000 + FOLGA_DE_RACIOCINIO);
  });

  it('não mexe no teto de modelo sem raciocínio adaptativo', () => {
    expect(orcamentoDeSaida('claude-haiku-4-5', 4_500)).toBe(4_500);
  });

  it('mantém o Leitor abaixo de 64 000', () => {
    expect(orcamentoDeSaida('claude-sonnet-5-5', 48_000)).toBeLessThanOrEqual(64_000);
  });
});

describe('schemaParaAnthropic', () => {
  it('fecha todo objeto, inclusive aninhado e dentro de array, sem mexer no original', () => {
    const original = {
      type: 'object',
      properties: {
        itens: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } },
        meta: { type: ['object', 'null'], properties: {} },
      },
    };
    const r = schemaParaAnthropic(original) as typeof original & { additionalProperties: boolean };
    expect(r.additionalProperties).toBe(false);
    expect((r.properties.itens.items as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect((r.properties.meta as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    expect((original as { additionalProperties?: boolean }).additionalProperties).toBeUndefined();
  });

  it('não sobrescreve um additionalProperties já declarado', () => {
    const r = schemaParaAnthropic({ type: 'object', additionalProperties: { type: 'string' } }) as Record<string, unknown>;
    expect(r.additionalProperties).toEqual({ type: 'string' });
  });
});
