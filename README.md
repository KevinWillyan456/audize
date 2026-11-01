<div align="center">

# 🎵 Audize

### **Player de música interativo com visualizador reativo, equalizador gráfico, temas, playlist inteligente e crossfade**

<br>

_Carregue sua música favorita e veja a mágica acontecer — capa do álbum, metadados, visualizer reativo, temas e muito mais._

<br>

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Web Audio API](https://img.shields.io/badge/Web_Audio_API-FF6B6B?style=for-the-badge&logoColor=white)

**[📖 Documentação](#-funcionalidades) · [🎨 Personalizar](#-personalização)**

<br>

---

</div>

<br>

## ✨ Funcionalidades

<table>
<tr>
<td width="50%">

### 🎨 Interface com Temas

- **5 temas** inclusos: Neon (padrão), 🌿 Forest, 🌅 Sunset, 🌊 Ocean, 💜 Lavender
- Seletor de temas no player (salvo no `localStorage`)
- Tema escuro com **efeito glassmorphism**
- Capa do álbum como **background com blur**
- Design **responsivo** (mobile e desktop) com scroll no mobile
- Animações suaves e micro-interações
- Partículas flutuantes na tela inicial (adaptam-se ao tema)

</td>
<td width="50%">

### 🎚️ Equalizador Gráfico

- 3 bandas: **Graves** (Lowshelf 250Hz), **Médios** (Peaking 1kHz Q0.7), **Agudos** (Highshelf 4kHz)
- Sliders de **-12dB a +12dB** com passo de 0.5dB
- Visualizador reage ao EQ em tempo real
- Abertura com **animação suave** (max-height + opacity)
- Duplo clique para **resetar** para flat

</td>
</tr>
<tr>
<td width="50%">

### 📋 Playlist Inteligente

- Selecione **múltiplos arquivos** de uma vez
- **Busca/filtro** por título, artista ou álbum (com highlight)
- Navegação **Anterior / Próxima**
- **3 modos de repetição**: sem repetir, repetir todas, repetir uma
- **Crossfade** de 3 segundos entre as músicas
- **Remover** músicas individualmente (botão X ao passar o mouse)
- **Adicionar** músicas sem perder a playlist atual
- Metadados e capas **cacheados** na playlist
- Scroll personalizado

</td>
<td width="50%">

### 🎆 Visualizer Reativo

- **2 modos** de visualização: barras verticais e **radial** (circular com rotação)
- Cores dinâmicas que seguem o **tema ativo**
- Suavização entre frames (EMA)
- **Partículas** que dançam com a música (spawn e burst)
- Pulso de **bass** e waveform no topo
- Modo **idle** animado quando pausado

</td>
</tr>
<tr>
<td width="50%">

### 📀 Extração de Metadados

- **Capa do álbum** extraída dos ID3 tags via jsmediatags
- Título, artista, álbum, ano, gênero
- Número da faixa, duração, formato
- Bitrate estimado e taxa de amostragem
- Fallback com gradiente nas **cores do tema**

</td>
<td width="50%">

### 🎮 Controles Completos

- Play / Pause com animação no botão
- Barra de seek com **preenchimento dinâmico** (sem flicker ao arrastar)
- Sliders de volume e duração com **fill gradiente**
- Controle de volume com mute
- **Atalhos de teclado** com modal de ajuda
- Drag & drop de arquivos de áudio

</td>
</tr>
</table>

<br>

## 🎹 Atalhos de Teclado

| Tecla    | Ação                            |
| -------- | ------------------------------- |
| `Espaço` | Play / Pause                    |
| `←`      | Faixa anterior (ou reiniciar)   |
| `→`      | Próxima faixa                   |
| `R`      | Ciclar modo repetição           |
| `E`      | Abrir / Fechar equalizador      |
| `?`      | Abrir / Fechar modal de atalhos |
| `Esc`    | Fechar modal / dropdown         |

> Pressione **`?`** no player para abrir o modal com todos os atalhos.

<br>

## 🎨 Temas

| Tema              | Cores                         | Preview                    |
| ----------------- | ----------------------------- | -------------------------- |
| **Neon** (padrão) | `#00d4ff` `#7b2ff7` `#ff2d95` | Ciano → Roxo → Rosa        |
| **Forest** 🌿     | `#00e676` `#ffd740` `#00bfa5` | Verde → Dourado → Teal     |
| **Sunset** 🌅     | `#ff6d00` `#ff1744` `#ff9100` | Laranja → Vermelho → Coral |
| **Ocean** 🌊      | `#00bcd4` `#2979ff` `#00e5ff` | Teal → Azul → Ciano        |
| **Lavender** 💜   | `#b388ff` `#e040fb` `#8c9eff` | Lilás → Rosa → Azul        |

O tema escolhido é **salvo automaticamente** no `localStorage` e persiste entre sessões. Visualizer, partículas, capa fallback e todos os elementos se adaptam ao tema.

<br>

## 🖼️ Preview

<div align="center">
<table>
<tr>
<td align="center"><strong>Tela Inicial</strong></td>
<td align="center"><strong>Player</strong></td>
<td align="center"><strong>Playlist</strong></td>
<td align="center"><strong>Equalizador</strong></td>
</tr>
<tr>
<td><img src="https://placehold.co/200x350/0a0a12/00d4ff?text=Upload" width="200" alt="Upload screen"></td>
<td><img src="https://placehold.co/200x350/0a0a12/7b2ff7?text=Player" width="200" alt="Player screen"></td>
<td><img src="https://placehold.co/200x350/0a0a12/ff2d95?text=Playlist" width="200" alt="Playlist"></td>
<td><img src="https://placehold.co/200x350/0a0a12/00d4ff?text=EQ" width="200" alt="Equalizer"></td>
</tr>
</table>
</div>

<br>

## 🚀 Como Usar

### 📦 Pré-requisitos

Nenhum! Apenas um navegador moderno (Chrome, Firefox, Edge, Safari).

### 🎯 Passo a passo

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/audize.git

# Entre no diretório
cd audize

# Abra o arquivo index.html no navegador
# (ou use um servidor local)
npx serve .
```

> 💡 **Dica:** Basta abrir o `index.html` diretamente no navegador — não precisa de servidor!

1. Clique em **"Escolher Arquivos"** ou arraste arquivos de áudio para a área de upload
2. A música começa a tocar automaticamente 🎵
3. Use os controles para navegar, ajustar volume e equalizar
4. Abra a **playlist** para ver todas as músicas carregadas
5. Clique em **`+`** para adicionar mais músicas sem perder a playlist
6. Clique no **🌞** para experimentar os temas
7. Ative o **equalizador** para ajustar graves, médios e agudos
8. Pressione **`?`** para ver todos os atalhos de teclado

<br>

## 🗂️ Estrutura do Projeto

```
audize/
├── index.html          # Estrutura principal do player
├── style.css           # Estilos com glassmorphism, temas e animações
├── script.js           # Engine completa do player
└── README.md           # Este arquivo
```

<br>

## 🛠️ Tecnologias Utilizadas

| Tecnologia               | Finalidade                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **HTML5**                | Estrutura semântica, SVG icons                                                                                                           |
| **CSS3**                 | Glassmorphism, variáveis CSS para temas, animações, `color-mix`, design responsivo                                                       |
| **JavaScript (Vanilla)** | Toda a lógica do player — zero dependências!                                                                                             |
| **Web Audio API**        | Visualizer em tempo real, analisador de frequência (`AnalyserNode`), filtros do equalizador (`BiquadFilterNode`), crossfade (`GainNode`) |
| **Canvas API**           | Renderização do visualizer (barras + radial) e sistema de partículas                                                                     |
| **jsmediatags**          | Extração de metadados ID3 (capa, título, artista, etc.)                                                                                  |

<br>

## 🎨 Personalização

### Temas

Os temas são definidos via classes CSS no `<html>`. Para criar um tema personalizado, adicione no `style.css`:

```css
.theme-meu-tema {
  --accent-1: #sua-cor;
  --accent-2: #sua-cor;
  --accent-3: #sua-cor;
  --bg-primary: #seu-fundo;
  /* opcional: bg-secondary, glass, text colors */
}
```

E registre no HTML como um botão no dropdown de temas.

### Visualizer

Ajuste os parâmetros no `script.js`:

```js
analyser.fftSize = 256 // Resolução das barras (128, 256, 512, 1024)
const CROSSFADE_DURATION = 3 // Duração do crossfade em segundos
smoothData[i] *= 0.75 // Fator de suavização (0-1)
```

### Partículas

```js
const MAX_PARTICLES = 250 // Máximo de partículas na tela
spawnAccumulator += energy * dt * 18 // Taxa de spawn
```

<br>

## 📄 Licença

Este projeto está sob a licença **MIT**. Sinta-se à vontade para usar, modificar e compartilhar.

```
MIT License

Copyright (c) 2026 Audize

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files...
```

<br>

---

<div align="center">

Feito com ☕ e 🎵

**Audize** — porque toda música merece uma capa bonita. 🎧

</div>
