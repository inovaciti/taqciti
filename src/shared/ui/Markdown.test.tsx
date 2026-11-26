import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Markdown, blocosDoMarkdown, destinoSeguro } from './Markdown';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(texto: string, onCitar?: (ref: string) => void) {
  act(() => root.render(<Markdown texto={texto} onCitar={onCitar} />));
}

it('a resposta que chegou crua vira negrito e lista, sem asteriscos à vista', () => {
  render(
    'A reunião teve pouco conteúdo [r1, r2].\n\n**Em aberto:**\n- Assunto ou pauta da reunião.\n- Quem participou.',
  );
  expect(host.textContent).not.toContain('**');
  expect(host.querySelector('strong')?.textContent).toBe('Em aberto:');
  expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
    'Assunto ou pauta da reunião.',
    'Quem participou.',
  ]);
});

it('a referência no texto abre a fonte certa', () => {
  const onCitar = vi.fn();
  render('O deploy ficou na sexta [r1; r3].', onCitar);
  const refs = [...host.querySelectorAll<HTMLButtonElement>('button.tq-md-ref')];
  expect(refs.map((b) => b.textContent)).toEqual(['r1', 'r3']);
  act(() => refs[1]!.click());
  expect(onCitar).toHaveBeenCalledWith('r3');
});

it('HTML vindo do modelo aparece escrito, nunca vira elemento', () => {
  render('<img src=x onerror="alert(1)"> e <script>alert(1)</script>');
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('script')).toBeNull();
  expect(host.textContent).toContain('<script>');
});

it('link só com http(s); o resto fica texto', () => {
  render('[ok](https://citi.org.br) e [ruim](javascript:alert(1))');
  const links = [...host.querySelectorAll('a')];
  expect(links).toHaveLength(1);
  expect(links[0]!.getAttribute('href')).toBe('https://citi.org.br');
  expect(links[0]!.getAttribute('rel')).toContain('noopener');
});

/**
 * Uma fala injetada pode fazer o modelo escrever um link que leva a conversa na
 * query. Só os hosts do próprio trabalho a mantêm; `script.google.com` e
 * `sites.google.com` hospedam página de qualquer um, e formulário do Google
 * recebe resposta pela query — os três perdem query e fragmento.
 */
it('destinoSeguro só mantém a query nos hosts do trabalho', () => {
  const agenda = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Reuniao';
  expect(destinoSeguro(agenda)?.href).toBe(agenda);
  expect(destinoSeguro('https://docs.google.com/document/d/abc/edit?tab=t.0')?.href).toContain('?tab=t.0');
  expect(destinoSeguro('https://intranet.citi.org.br/p?x=1')?.href).toContain('?x=1');

  for (const fora of [
    'https://script.google.com/macros/s/X/exec?d=segredo',
    'https://sites.google.com/view/x?d=segredo',
    'https://docs.google.com/forms/d/e/X/formResponse?entry.1=segredo',
    'http://docs.google.com/document/d/abc?d=segredo',
    'https://exemplo.com/p?d=segredo#frag',
  ]) {
    const r = destinoSeguro(fora);
    expect(r?.href).not.toContain('segredo');
    expect(r?.href).not.toContain('#frag');
  }
});

it('títulos, lista numerada, sublista, código e itálico', () => {
  const blocos = blocosDoMarkdown(
    '### Decisões\n1. Deploy na sexta\n2. Revisão\n  - com a Ana\n\n```\nnpm test\n```\nUm _detalhe_ e `código`.',
  );
  expect(blocos.map((b) => b.tipo)).toEqual(['h', 'ol', 'codigo', 'p']);
  render('### Decisões\n1. Deploy na sexta\n2. Revisão\n  - com a Ana\n\nUm _detalhe_ e `código`.');
  expect(host.querySelector('h4, h3')?.textContent).toBe('Decisões');
  expect(host.querySelectorAll('ol > li')).toHaveLength(2);
  expect(host.querySelector('ol li ul li')?.textContent).toBe('com a Ana');
  expect(host.querySelector('em')?.textContent).toBe('detalhe');
  expect(host.querySelector('code')?.textContent).toBe('código');
});

it('snake_case e 2*3*4 não viram itálico', () => {
  render('o campo reuniao_id_novo e a conta 2*3*4');
  expect(host.querySelector('em')).toBeNull();
});
