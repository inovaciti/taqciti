/**
 * `comPrazo`: depois do corte, distingue quem cortou — a pessoa (cancelar,
 * que não ganha mensagem) ou o prazo (que ganha).
 */
import { describe, expect, it } from 'vitest';
import { comPrazo, mensagemDeRecusa } from './respostaDoServidor';

/**
 * 401 tem duas causas que pedem ações diferentes: chave da extensão recusada
 * (atualizar) e ponte do segredo desligada sem a conta do CITi (entrar). O
 * servidor marca a segunda com `codigo: 'entrar_com_conta'` (guardaDeIa.ts).
 */
describe('mensagemDeRecusa no 401', () => {
  const recusa = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 401 });

  it('sem a conta do CITi, manda entrar — não atualizar', async () => {
    const msg = await mensagemDeRecusa(recusa({ error: 'x', codigo: 'entrar_com_conta' }), '/api/generate');
    expect(msg).toMatch(/conta do CITi/);
    expect(msg).not.toMatch(/Atualize/);
  });

  it('chave recusada, sem código, continua pedindo para atualizar', async () => {
    expect(await mensagemDeRecusa(recusa({ error: 'Unauthorized' }), '/api/generate')).toMatch(/Atualize/);
  });
});

const esperarAborto = (s: AbortSignal) =>
  new Promise<void>((ok) => (s.aborted ? ok() : s.addEventListener('abort', () => ok())));

describe('comPrazo', () => {
  it('o prazo corta e se diz esgotado', async () => {
    const corte = comPrazo(undefined, 20);
    await esperarAborto(corte.signal);
    expect(corte.esgotado()).toBe(true);
    expect(corte.cancelado()).toBe(false);
  });

  it('o cancelar de quem pediu corta e não se diz esgotado', async () => {
    const controle = new AbortController();
    const corte = comPrazo(controle.signal, 60_000);
    controle.abort();
    await esperarAborto(corte.signal);
    expect(corte.cancelado()).toBe(true);
    expect(corte.esgotado()).toBe(false);
  });
});
