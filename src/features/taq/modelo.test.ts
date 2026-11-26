/**
 * Recusas de `autorizarIa` (server/lib/guardaDeIa.ts) chegam ANTES do Taq, no
 * formato das rotas de geração (`{ error, codigo }`), não no `{ erro }` do
 * turno. Sem lê-las, a cota do dia virava "tente de novo" (tentar de novo não
 * adianta até amanhã) e faltar a conta do CITi virava "atualize a extensão".
 */
import { describe, expect, it } from 'vitest';
import { criarAdaptadorHttp, ErroDoModelo } from './modelo';

function adaptadorQueResponde(status: number, corpo: unknown) {
  const transporte = (async () =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  return criarAdaptadorHttp({ baseUrl: 'https://servidor.exemplo', chave: 'k', transporte });
}

async function erroDoTurno(status: number, corpo: unknown): Promise<ErroDoModelo> {
  const pedido = {} as Parameters<ReturnType<typeof criarAdaptadorHttp>['turno']>[0];
  try {
    await adaptadorQueResponde(status, corpo).turno(pedido, new AbortController().signal);
  } catch (e) {
    if (e instanceof ErroDoModelo) return e;
    throw e;
  }
  throw new Error('o turno deveria ter falhado');
}

describe('recusas da guarda de IA', () => {
  it('429 da cota da pessoa vira cota_do_dia, não transitório', async () => {
    const e = await erroDoTurno(429, { error: 'Você atingiu o limite diário de uso da IA. Ele volta amanhã.', codigo: 'cota_do_dia' });
    expect(e.codigo).toBe('cota_do_dia');
    expect(e.transitorio).toBe(false);
  });

  it('401 sem a conta do CITi vira entrar_com_conta', async () => {
    const e = await erroDoTurno(401, { error: 'Entre com a conta do CITi…', codigo: 'entrar_com_conta' });
    expect(e.codigo).toBe('entrar_com_conta');
  });

  it('401 da chave errada (sem código) continua nao_autorizado', async () => {
    const e = await erroDoTurno(401, { error: 'Unauthorized' });
    expect(e.codigo).toBe('nao_autorizado');
  });

  it('o erro do próprio Taq ({ erro }) continua lido como antes', async () => {
    const e = await erroDoTurno(429, {
      erro: { codigo: 'limite_do_provedor', mensagem: 'cota por minuto', transitorio: true },
    });
    expect(e.codigo).toBe('limite_do_provedor');
    expect(e.transitorio).toBe(true);
  });
});
