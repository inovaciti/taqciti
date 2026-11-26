/**
 * Revisão da transcrição por IA, depois de salvar o original. Falhas nunca
 * impedem o encerramento nem tocam o original: o que não foi revisado continua
 * como veio, e a revisão fica ao lado (`registro.revisao`), nunca no lugar.
 *
 * Vai em lotes desde 25/11/2026 (`transcricao-v2`; o porquê está em
 * `lotesDeRevisao.ts`): em chamada única ela nunca chegava ao fim numa reunião
 * real. Lote que falha duas vezes fica sem revisão, e os outros valem; nenhum
 * lote aproveitado = nada é gravado.
 */
import { criarAdaptadorHttp, type AdaptadorDeModelo } from '@/features/taq/modelo';
import type { MeetingRecord } from '@/shared/types/domain';
import { guardarRevisao } from '@/background/history';
import { revisarEmLotes, tokensDeSaidaPara } from './lotesDeRevisao';

/** Por lote. Um lote de ~4 mil caracteres leva ~10 s no Haiku; a folga cobre fila do provedor. */
const PRAZO_DO_LOTE_MS = 45_000;

export async function revisarTranscricao(
  original: MeetingRecord,
  modelo: AdaptadorDeModelo = criarAdaptadorHttp({ interativo: false }),
): Promise<void> {
  try {
    if (original.revisao || original.status !== 'ready' || !original.segments.length) return;
    const { revisadas } = await revisarEmLotes(
      original.segments.map((s) => ({ id: s.captionId, ...(s.speaker ? { pessoa: s.speaker } : {}), texto: s.text })),
      async (lote) => {
        const resposta = await modelo.turno(
          {
            instrucoes: 'transcricao-v2',
            contexto: JSON.stringify(lote),
            mensagens: [{ papel: 'pessoa', texto: 'Revise as falas de `falas` e devolva o JSON completo.' }],
            ferramentas: [],
            maxTokensDeSaida: tokensDeSaidaPara(lote),
          },
          AbortSignal.timeout(PRAZO_DO_LOTE_MS),
        );
        return resposta.tipo === 'final' && !resposta.chamadas.length ? resposta.texto : null;
      },
    );
    if (revisadas.size === 0) return;
    await guardarRevisao(original, {
      segmentos: original.segments.map((s) => ({ ...s, text: revisadas.get(s.captionId) ?? s.text })),
      revisadaEm: Date.now(),
    });
  } catch {
    // Sem correção heurística, notificações ou alteração do original.
  }
}
