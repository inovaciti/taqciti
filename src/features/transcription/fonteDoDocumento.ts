/**
 * A transcrição que vai para a geração de um documento: a REVISADA, com nomes
 * de verdade.
 *
 * Desde 26/11/2026 (decisão do usuário), o documento sai da transcrição que o
 * Sonnet revisou (`revisao.ts`), e não da legenda crua: com o ruído limpo, o
 * Haiku basta para gerar, e o Auditor deixa de reprovar fala que só estava mal
 * transcrita ("data de reunião" por "a ata da reunião"). O preço é que o
 * Auditor passa a conferir contra a revisão, e não contra a legenda — por isso
 * a revisão tem guarda em código (número, negação e tamanho não mudam) e fica
 * guardada AO LADO do original, que continua intacto.
 *
 * E "Você" vira nome. O Meet rotula assim quem está gravando, e o rótulo
 * chegava à ata como participante sem nome e como "Sem responsável definido"
 * nas ações que essa pessoa assumiu. Quem é, nesta ordem:
 *   1. o participante cujo nome casa com o e-mail da conta do CITi ligada ao
 *      TaqCiti (`debora.cunha@…` → "Débora Cunha", com os acentos da lista);
 *   2. o ÚNICO participante da lista que nunca aparece como falante (o próprio
 *      "Você" — ninguém mais fala sem rótulo);
 *   3. o nome montado do e-mail ("Debora Cunha"), quando há conta e a lista
 *      não ajuda.
 * Sem nada disso, o rótulo fica, e o servidor o trata como antes.
 *
 * Imports relativos de propósito: o servidor reaproveita este arquivo nos
 * testes ao vivo, e lá o `@/` aponta para outra raiz.
 */
import type { LiveSegment, MeetingRecord } from '../../shared/types/domain';
import { desfazerNomeDuplicado, isSelfCaptionLabel } from './sanitize';
import { identityKey } from './speakerIdentity';

type Fonte = Pick<MeetingRecord, 'segments' | 'participants'> & Partial<Pick<MeetingRecord, 'revisao'>>;

const palavras = (nome: string) => identityKey(nome).split(' ').filter(Boolean);

/** "debora.cunha@citi.org.br" → ["debora", "cunha"]. */
function palavrasDoEmail(email: string): string[] {
  return palavras((email.split('@')[0] ?? '').replace(/[._\-+0-9]+/g, ' '));
}

export function nomeDoSelf(fonte: Fonte, emailDaConta?: string | null): string | null {
  const participantes = fonte.participants
    .map((p) => desfazerNomeDuplicado(p.name.trim()))
    .filter((nome) => nome && !isSelfCaptionLabel(nome));

  const doEmail = emailDaConta ? palavrasDoEmail(emailDaConta) : [];
  if (doEmail.length > 0) {
    const casou = participantes.find((nome) => {
      const doNome = palavras(nome);
      return doEmail.every((p) => doNome.includes(p));
    });
    if (casou) return casou;
  }

  const falantes = new Set(
    fonte.segments.map((s) => (s.speaker ? identityKey(desfazerNomeDuplicado(s.speaker)) : '')),
  );
  const calados = participantes.filter((nome) => !falantes.has(identityKey(nome)));
  if (calados.length === 1) return calados[0]!;

  if (doEmail.length > 0) return doEmail.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');
  return null;
}

// Sem a flag `i`: ela faria `\p{Lu}` aceitar minúscula, e "meu nome é disso" viraria nome.
const APRESENTACAO = /(?:^|[^\p{L}])(?:[Mm]eu nome [ée]|[Mm]e chamo|[Pp]ode me chamar de)\s+(\p{Lu}[\p{L}'-]+)/u;
/** "Thiago"/"Tiago", "Thaís"/"Taís": a mesma pessoa, grafada diferente. */
const semH = (p: string) => identityKey(p).replace(/h/g, '');

/**
 * A conta do Meet nem sempre é de quem fala: numa reunião real (25/11/2026) o
 * cliente entrou pela conta de um colega, se apresentou como outra pessoa e foi
 * chamado por esse nome a reunião inteira — e a ata saiu com um nome na lista
 * de participantes e outro no texto. Aqui o nome DITO vai para o rótulo,
 * "Rafael (Ana Souza)", mas só quando a pessoa se apresentou com ele E outra
 * pessoa o usou: a legenda erra nomes ("meu nome é disso"), e um nome que só o
 * próprio falante "disse" pode ser só ruído.
 */
export function nomesDitos(segmentos: readonly LiveSegment[]): Map<string, string> {
  const ditos = new Map<string, string>();
  for (const s of segmentos) {
    if (!s.speaker || ditos.has(s.speaker) || isSelfCaptionLabel(s.speaker)) continue;
    const nome = APRESENTACAO.exec(s.text)?.[1];
    if (!nome || semH(nome) === semH(s.speaker.split(' ')[0] ?? '')) continue;
    const usadoPorOutro = segmentos.some(
      (o) => o.speaker !== s.speaker && new RegExp(`(^|[^\\p{L}])${nome}(?=$|[^\\p{L}])`, 'u').test(o.text),
    );
    if (usadoPorOutro) ditos.set(s.speaker, nome);
  }
  return ditos;
}

/** As falas para o documento: revisadas quando houver, com rótulos limpos e "Você" com nome. */
export function segmentosDoDocumento(fonte: Fonte, emailDaConta?: string | null): LiveSegment[] {
  const base = (fonte.revisao?.segmentos.length ? fonte.revisao.segmentos : fonte.segments).map((s) =>
    s.speaker && !isSelfCaptionLabel(s.speaker) ? { ...s, speaker: desfazerNomeDuplicado(s.speaker) } : s,
  );
  const temSelf = base.some((s) => isSelfCaptionLabel(s.speaker));
  const self = temSelf ? nomeDoSelf(fonte, emailDaConta) : null;
  const ditos = nomesDitos(base);
  return base.map((s) => {
    if (!s.speaker) return s;
    if (isSelfCaptionLabel(s.speaker)) return self ? { ...s, speaker: self } : s;
    const dito = ditos.get(s.speaker);
    return dito ? { ...s, speaker: `${dito} (${s.speaker})` } : s;
  });
}
