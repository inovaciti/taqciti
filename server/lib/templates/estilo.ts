/**
 * Regras de redação comuns aos documentos do catálogo.
 *
 * Ata e Resumo são registro institucional, não narrativa de quem disse o quê
 * (pedido do usuário, 26/11/2026: o documento dizia "Fulano disse…" onde cabia
 * "foi acordado…"). A regra vai no `guidance` das seções marcadas
 * `impessoal: true`; o que escapa (frase auditada com nome de participante) é
 * reescrito pelo reparo — ver `apurar` em `generateStep.ts`. Nomes ficam só em
 * Participantes e no responsável de um encaminhamento. Hipótese continua
 * hipótese, sem nome: "foi levantada a hipótese de que…".
 */
export const REDACAO_IMPESSOAL = [
  'REDAÇÃO IMPESSOAL: escreva em voz passiva ou impessoal ("foi informado que",',
  '"acordou-se", "foi solicitado", "foi levantada a dúvida sobre"). Não use nome de',
  'pessoa neste campo — nomes só entram em Participantes e no responsável de um',
  'encaminhamento. Quando importar de que lado veio, use o papel ("o cliente", "a',
  'equipe do projeto"), nunca o nome. Hipótese continua hipótese ("foi levantada a',
  'hipótese de que").',
].join(' ');
