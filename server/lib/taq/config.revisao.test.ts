import { describe, expect, it } from 'vitest';
import { PADRAO, PADRAO_DA_REVISAO, resolverConfiguracao } from './config';

/**
 * A revisão da transcrição tem modelo próprio (26/11/2026, decisão do usuário:
 * o Sonnet limpa o ruído, e o Haiku gera a partir do texto limpo). O Taq não
 * pode mudar de modelo por causa disso.
 */
const ENV = { ANTHROPIC_API_KEY: 'x', DOCCITI_DATA_POLICY: 'private' } as unknown as NodeJS.ProcessEnv;

describe('modelo da revisão', () => {
  it('transcricao-* usa TAQ_REVISAO (Sonnet por padrão); o resto continua no orquestrador', () => {
    expect(`anthropic:${resolverConfiguracao(ENV, 'transcricao-v2').modelo}`).toBe(PADRAO_DA_REVISAO);
    expect(`anthropic:${resolverConfiguracao(ENV, 'taq-v7').modelo}`).toBe(PADRAO);
    expect(`anthropic:${resolverConfiguracao(ENV).modelo}`).toBe(PADRAO);
  });

  it('TAQ_REVISAO troca só a revisão', () => {
    const env = { ...ENV, TAQ_REVISAO: 'anthropic:modelo-da-revisao', TAQ_ORQUESTRADOR: 'anthropic:modelo-do-taq' };
    expect(resolverConfiguracao(env, 'transcricao-v1').modelo).toBe('modelo-da-revisao');
    expect(resolverConfiguracao(env, 'taq-v7').modelo).toBe('modelo-do-taq');
  });
});
