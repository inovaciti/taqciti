# Como instalar a extensão TaqCiti

A extensão funciona tanto no **Google Chrome** quanto no **Microsoft Edge**
(os dois são baseados em Chromium e carregam extensões do mesmo jeito) — em
Windows, macOS ou Linux.

Existem dois caminhos, e os dois entregam a mesma extensão:

- **Pedir a um assistente de IA** (recomendado) — o Claude ou o ChatGPT, com
  acesso ao seu computador ou navegador, faz os passos por você.
- **Instalação manual** — você mesmo baixa o `.zip` e carrega a pasta no
  navegador. São quatro passos, descritos abaixo.

> Até 13/11/2026 havia instaladores nativos (`.exe`, `.pkg`, `.run`) e um
> guia `COMECE_AQUI.html`. Eles foram abandonados: carregar a pasta da
> extensão é mais simples do que qualquer instalador, e um assistente faz isso
> sozinho.

---

## 1. Pedindo a um assistente de IA (recomendado)

Abra o Claude Desktop (ou outro assistente que consiga rodar comandos no seu
computador) e diga:

> Instale a extensão TaqCiti seguindo o INSTALL.md de
> https://github.com/inovaciti/taqciti — a seção "Roteiro para o assistente".

O assistente baixa, confere e prepara tudo. No fim sobra **um clique seu**: o
navegador não deixa nenhum programa carregar uma extensão sozinho, então você
escolhe a pasta em "Carregar sem compactação" (o assistente diz qual).

### Roteiro para o assistente

> Esta seção é escrita para o assistente de IA que vai fazer a instalação.
> Siga na ordem e não pule as conferências: cada uma existe porque aquele
> erro já aconteceu.

**Regra principal: entregue a extensão da release, não uma build do código.**
O zip da release é a build de produção, feita pelo CI com o endereço do
servidor e os identificadores do Google gravados dentro. Esses valores ficam
num `.env` que **não está no repositório**. Uma build feita a partir do clone
sem esse `.env` carrega normalmente e parece funcionar, mas o Taq e a
sincronização falham em silêncio, porque ficam chamando `http://localhost:3000`.
Foi exatamente o que aconteceu na primeira instalação fora da equipe.

**Passo 1. Descubra o navegador e o sistema.** Pergunte se a pessoa usa
Chrome ou Edge, se não for óbvio. Funciona em Windows, macOS e Linux.

**Passo 2. Baixe a última release numa pasta fixa.** A pasta não pode ser
temporária nem a de Downloads: o navegador lê os arquivos direto dela para
sempre, e apagá-la quebra a extensão. Use:

| Sistema | Pasta |
|---|---|
| Windows | `%LOCALAPPDATA%\TaqCiti\<versão>` |
| macOS | `~/Library/Application Support/TaqCiti/<versão>` |
| Linux | `~/.local/share/TaqCiti/<versão>` |

Pegue a versão e os links pela API pública do GitHub (não precisa de login):
`https://api.github.com/repos/inovaciti/taqciti/releases/latest`. Baixe os
dois arquivos da release: `taqciti-v<versão>.zip` e `SHA256SUMS.txt`.

Windows (PowerShell):

```powershell
$rel = Invoke-RestMethod https://api.github.com/repos/inovaciti/taqciti/releases/latest
$versao = $rel.tag_name
$pasta = Join-Path $env:LOCALAPPDATA "TaqCiti\$versao"
New-Item -ItemType Directory -Force $pasta | Out-Null
foreach ($a in $rel.assets) { Invoke-WebRequest $a.browser_download_url -OutFile (Join-Path $pasta $a.name) }
```

macOS / Linux:

```sh
versao=$(curl -fsSL https://api.github.com/repos/inovaciti/taqciti/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)
pasta="$HOME/.local/share/TaqCiti/$versao"   # no macOS: "$HOME/Library/Application Support/TaqCiti/$versao"
mkdir -p "$pasta" && cd "$pasta"
for f in "taqciti-$versao.zip" SHA256SUMS.txt; do
  curl -fLO "https://github.com/inovaciti/taqciti/releases/download/$versao/$f"
done
```

**Passo 3. Confira a integridade.** O SHA-256 do zip tem de ser igual ao que
está no `SHA256SUMS.txt`. Windows: `Get-FileHash <zip> -Algorithm SHA256`.
macOS: `shasum -a 256 -c SHA256SUMS.txt`. Linux: `sha256sum -c SHA256SUMS.txt`.
Se não bater, pare e avise a pessoa. Não instale.

**Passo 4. Extraia** numa subpasta `extensao` dentro da pasta do passo 2
(Windows: `Expand-Archive`; macOS/Linux: `unzip`). O `manifest.json` precisa
ficar **direto** em `extensao/`, não numa pasta a mais dentro dela.

**Passo 5. Confira se é a build de produção.** Procure nos arquivos `.js` de
`extensao/`:

- `localhost:3000` e `taqciti-dev-local` **não** podem aparecer;
- um endereço `https://` do servidor **tem** de aparecer.

Se falhar, a release saiu errada. Pare e avise a equipe; não tente consertar
buildando do código.

**Passo 6. Se já existe uma versão antiga instalada,** peça à pessoa para
removê-la em `chrome://extensions` (botão "Remover") antes de carregar a nova.
Só apague a pasta antiga depois disso.

**Passo 7. Abra a página de extensões** (`chrome://extensions` ou
`edge://extensions`) e guie a pessoa no último passo: ligar o **Modo do
desenvolvedor**, clicar em **"Carregar sem compactação"** e escolher a pasta
`extensao/`. Diga o caminho completo da pasta. Se você controla o navegador,
pode ligar o modo do desenvolvedor, mas a escolha da pasta é sempre da pessoa.

**Passo 8. Entregue.** Diga à pessoa que versão instalou e onde a pasta ficou
(e que ela não deve apagar essa pasta). Diga também o que fazer em seguida:
abrir o TaqCiti, ir em **Conexões** e entrar com a conta do CITi. Sem esse
login o Taq e a sincronização não funcionam.

#### Quando a pessoa pede a versão do código (mais nova que a release)

Só faça isso se ela tiver o `.env` de build da equipe, entregue por canal
privado. Ele nunca vai para o repositório nem para uma conversa pública. Sem o
`.env`, explique o motivo e instale a release. **Nunca** entregue o resultado
de `npm run build:dev` ou `npm run dev`: essas builds apontam para
`localhost`.

1. Requisitos: `git` e Node.js 20 ou mais novo.
2. `git clone https://github.com/inovaciti/taqciti.git` numa pasta fixa e
   coloque o `.env` na raiz do clone.
3. `npm ci` e depois `npm run build`. Se a build parar com "Build de produção
   recusada", o `.env` está incompleto ou errado. Peça um novo; não contorne a
   trava.
4. Faça a conferência do passo 5 na pasta `dist/` e carregue `dist/` como no
   passo 7. Para atualizar depois: `git pull`, `npm ci`, `npm run build` e
   o botão de recarregar da extensão em `chrome://extensions`.

---

## 2. Instalação manual (a partir do `.zip`)

Vale nos três sistemas operacionais e nos dois navegadores — só muda o
endereço da página de extensões.

### 1. Baixe e descompacte

Baixe o `taqciti-vX.Y.Z.zip` da [última
release](https://github.com/inovaciti/taqciti/releases/latest), salve numa
pasta fixa do computador (ex.: área de trabalho) e extraia. Não use uma build
feita a partir do código sem o `.env` da equipe: ela abre, mas o Taq e a
sincronização não funcionam (veja o roteiro acima). **Não apague nem mova essa pasta depois** — é dela
que o navegador vai ler os arquivos direto; movê-la ou apagá-la quebra a
extensão.

### 2. Abra a página de extensões do seu navegador

| Navegador | Endereço |
|---|---|
| Google Chrome | `chrome://extensions` |
| Microsoft Edge | `edge://extensions` |

Copie e cole o endereço correspondente na barra de endereços e aperte
Enter.

### 3. Ative o "Modo do desenvolvedor"

- **Chrome**: interruptor no canto superior direito da página.
- **Edge**: interruptor na barra lateral esquerda da página.

### 4. Carregue a extensão

Com o modo do desenvolvedor ativo, clique em **"Carregar sem
compactação"** (o texto do botão é o mesmo nos dois navegadores) e
selecione a pasta que você descompactou no passo 1 — a pasta em si, não o
arquivo `.zip`.

Pronto! A extensão TaqCiti vai aparecer na lista e já está pronta para uso.

---

### Perguntas frequentes

**Preciso repetir esses passos toda vez que abrir o navegador?**
Não. Depois de carregada, a extensão fica instalada normalmente, como
qualquer outra.

**Recebi uma versão nova. O que eu faço?**
Descompacte o novo arquivo `.zip` em uma pasta separada, vá na página de
extensões do seu navegador, remova a versão antiga (botão "Remover") e
repita o passo 4 apontando para a pasta nova.

**O navegador mostra um aviso dizendo que o "Modo do desenvolvedor" pode
ser perigoso. É normal?**
Sim. Esse aviso aparece para qualquer extensão carregada dessa forma (fora
da loja oficial) e não indica nenhum problema com a TaqCiti.

**O navegador avisa que a extensão pode "ler e alterar todos os seus dados
nos sites que você visita". Por quê?**
Porque o TaqCiti tira **prints** da aba que você está vendo quando você pede, e o
navegador só permite isso a uma extensão com acesso declarado a todos os sites.
A leitura de página, porém, acontece **só em `meet.google.com`**: é lá que o
TaqCiti desenha a **cápsula** e lê as legendas da reunião. Nenhuma outra página
recebe a cápsula nem tem o conteúdo lido.

**Depois de instalar, o que faço?**
Abra o TaqCiti, vá em **Conexões** e entre com a sua conta do CITi. É com ela
que o assistente (Taq) e a sincronização funcionam.

**O que sai do meu computador?**
Por padrão, nada: a transcrição, as notas, as marcações e os prints ficam no
armazenamento local do navegador. Duas coisas saem, e as duas começam com um
clique seu:

- **Gerar documento** manda a transcrição daquela reunião para o servidor do
  TaqCiti, que devolve a ata;
- **Conexões → ligar a sincronização** passa a enviar as reuniões para o
  servidor, para que um cliente de IA possa lê-las pelo conector. Enquanto
  você não ligar, ela fica desligada, e o resto do produto funciona igual.

Apagar uma reunião, um documento, uma conversa ou uma nota remove a cópia deste
computador — e, se a sincronização estiver ligada, a próxima passada apaga a
cópia do servidor também. O que sumiu daqui some de lá; não é preciso repetir a
remoção em dois lugares.
