import { describe, expect, it } from 'vitest';
import { anchorQuotes } from '../documentData';
import { createLocator } from './anchoring';

/**
 * "Perfeito." aparece dezenas de vezes numa reunião. Até 26/11/2026 o aceite
 * citado junto de um pedido era ancorado no PRIMEIRO "Perfeito" da
 * transcrição, o Auditor via a marca no lugar errado, e o combinado de enviar
 * a ata caía. Dados inventados.
 */
const transcript = [
  '[00:10] Ana: Perfeito. Vamos começar.',
  '[05:00] Rui: Perfeito, entendi o cronograma.',
  '[25:00] Rui: Fico no aguardo da ata da reunião.',
  '[25:05] Ana: Perfeito.',
].join('\n');

describe('âncora perto da afirmação', () => {
  it('a segunda citação de um item é a ocorrência mais próxima da primeira', () => {
    const locator = createLocator(transcript);
    const [pedido, aceite] = anchorQuotes(['Fico no aguardo da ata da reunião.', 'Perfeito.'], (q, p) => locator.locate(q, p));
    expect(aceite!.anchor!.start).toBe(transcript.lastIndexOf('Perfeito.'));
    expect(aceite!.anchor!.start).toBeGreaterThan(pedido!.anchor!.start);
  });

  it('sem referência, continua a busca de sempre', () => {
    const locator = createLocator(transcript);
    expect(locator.locate('Perfeito.')!.start).toBe(transcript.indexOf('Perfeito.'));
  });

  it('`perto` vindo de fora (o reparo): perto das citações que o item já tinha', () => {
    const locator = createLocator(transcript);
    const [aceite] = anchorQuotes(['Perfeito.'], (q, p) => locator.locate(q, p), transcript.indexOf('Fico no aguardo'));
    expect(aceite!.anchor!.start).toBe(transcript.lastIndexOf('Perfeito.'));
  });
});
