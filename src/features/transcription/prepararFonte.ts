/**
 * A reunião pronta para virar documento: revisada e com nomes (ver
 * `fonteDoDocumento.ts` para o porquê, 26/11/2026).
 *
 * A revisão roda sozinha ao fim da reunião; quando a pessoa pede um documento
 * antes de ela terminar — ou numa reunião antiga, de antes da revisão em lotes
 * —, ela roda aqui, e o documento espera (~20 s numa reunião de meia hora). Se
 * falhar, o documento sai da transcrição original: revisar melhora o
 * documento, mas não pode impedi-lo.
 */
import { listHistory } from '@/background/history';
import { emailDaConta } from '@/shared/services/identidade';
import type { MeetingRecord } from '@/shared/types/domain';
import { segmentosDoDocumento } from './fonteDoDocumento';
import { revisarTranscricao } from './revisao';

export async function prepararFonte(
  registro: MeetingRecord,
  revisar: (r: MeetingRecord) => Promise<void> = revisarTranscricao,
): Promise<MeetingRecord> {
  let atual = registro;
  try {
    if (!atual.revisao && atual.status === 'ready' && atual.segments.length > 0) {
      await revisar(atual);
      atual = (await listHistory()).find((r) => r.id === registro.id) ?? atual;
    }
  } catch {
    // Sem revisão, o documento sai do original — nunca deixa de sair.
  }
  return { ...atual, segments: segmentosDoDocumento(atual, await emailDaConta()) };
}
