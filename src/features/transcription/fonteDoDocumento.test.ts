import { describe, expect, it } from 'vitest';
import type { LiveSegment } from '@/shared/types/domain';
import { nomeDoSelf, nomesDitos, segmentosDoDocumento } from './fonteDoDocumento';
import { desfazerNomeDuplicado } from './sanitize';

/**
 * O documento sai da transcrição revisada e com nomes (26/11/2026). Numa
 * reunião real, quem gravou aparecia como "Você" (sumia da ata e deixava as
 * ações dela sem responsável), todos os nomes vinham duplicados pelo Meet, e o
 * cliente, que entrou pela conta de um colega, tinha um nome na lista e outro
 * no texto. Dados inventados.
 */
const fala = (speaker: string, text: string, i = 0): LiveSegment => ({
  captionId: `c${i}`,
  speaker,
  text,
  startOffsetMs: i * 1000,
  endOffsetMs: i * 1000 + 500,
});

const reuniao = {
  participants: [
    { name: 'Carla Diascarla Dias', isHost: null },
    { name: 'Ana Souzaana Souza', isHost: null },
    { name: 'Bruno Lima', isHost: null },
  ],
  segments: [
    fala('Você', 'Boa tarde, Rafael. Meu nome é Carola, eu conduzo hoje.', 1),
    fala('Ana Souzaana Souza', 'Boa tarde. Meu nome é Rafael, estou pela conta da Ana.', 2),
    fala('Bruno Lima', 'Meu nome é Bruno. Rafael, pode mandar a lista?', 3),
    fala('Ana Souzaana Souza', 'Mando sim.', 4),
  ],
};

describe('nome duplicado pelo Meet', () => {
  it('corta a cópia colada, e não mexe em nome que só se parece com isso', () => {
    expect(desfazerNomeDuplicado('Ana Souzaana Souza')).toBe('Ana Souza');
    expect(desfazerNomeDuplicado('Carlos Lima Duartecarlos')).toBe('Carlos Lima Duarte');
    expect(desfazerNomeDuplicado('Marimar')).toBe('Marimar');
    expect(desfazerNomeDuplicado('Ana Ana')).toBe('Ana Ana');
    expect(desfazerNomeDuplicado('Bruno Lima')).toBe('Bruno Lima');
  });
});

describe('quem é "Você"', () => {
  it('pelo e-mail da conta, com a grafia (e os acentos) da lista de participantes', () => {
    const comAcento = { ...reuniao, participants: [...reuniao.participants, { name: 'Débora Cunha', isHost: null }] };
    expect(nomeDoSelf(comAcento, 'debora.cunha@citi.org.br')).toBe('Débora Cunha');
  });

  it('sem e-mail: o único participante que nunca aparece como falante', () => {
    expect(nomeDoSelf(reuniao, null)).toBe('Carla Dias');
  });

  it('e-mail que não casa com a lista, e lista que não decide: o nome sai do e-mail', () => {
    const semCalado = { ...reuniao, participants: reuniao.participants.slice(1) };
    expect(nomeDoSelf(semCalado, 'joao.pereira@citi.org.br')).toBe('Joao Pereira');
    expect(nomeDoSelf(semCalado, null)).toBeNull();
  });
});

describe('nome dito', () => {
  it('vale quando a pessoa se apresenta E outra pessoa o usa; "meu nome é Carola" (só dito por quem fala) não', () => {
    const ditos = nomesDitos(reuniao.segments.map((s) => ({ ...s, speaker: desfazerNomeDuplicado(s.speaker!) })));
    expect(ditos).toEqual(new Map([['Ana Souza', 'Rafael']]));
  });

  it('o mesmo nome com outra grafia não conta como outro nome', () => {
    const ditos = nomesDitos([fala('Thiago Rocha', 'Me chamo Tiago.'), fala('Ana', 'Obrigada, Tiago.')]);
    expect(ditos.size).toBe(0);
  });
});

describe('segmentosDoDocumento', () => {
  it('usa a revisão, tira a duplicação, dá nome ao "Você" e junta o nome dito à conta', () => {
    const revisada = { ...reuniao, revisao: { segmentos: reuniao.segments.map((s) => ({ ...s, text: s.text.replace('Mando sim.', 'Mando, sim.') })), revisadaEm: 1 } };
    const falas = segmentosDoDocumento(revisada, null);
    expect(falas.map((s) => s.speaker)).toEqual(['Carla Dias', 'Rafael (Ana Souza)', 'Bruno Lima', 'Rafael (Ana Souza)']);
    expect(falas[3]!.text).toBe('Mando, sim.');
    // O original não é tocado.
    expect(reuniao.segments[0]!.speaker).toBe('Você');
  });

  it('sem revisão, sai do original', () => {
    expect(segmentosDoDocumento(reuniao, null)[3]!.text).toBe('Mando sim.');
  });
});
