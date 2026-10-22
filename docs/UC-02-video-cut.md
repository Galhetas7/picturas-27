# UC-02 — Corte de vídeo

Esta alteração acrescenta uma operação de corte de um trecho de vídeo MP4 ao editor de vídeo existente.

## Fluxo

1. No projeto, abre **Vídeos → Cortar**.
2. Usa o MP4 já associado ao projeto ou seleciona um novo ficheiro para carregar.
3. Define o início e o fim em segundos. O trecho tem de durar pelo menos 1 segundo e não pode cobrir o vídeo completo.
4. O serviço `projects` valida o projeto, a versão, a duração, o tamanho, a resolução e o perfil do utilizador, reserva uma operação avançada para contas `free` e publica o trabalho na fila de vídeo.
5. O worker executa FFmpeg, preserva o original e produz um novo MP4/H.264 com áudio, quando presente.
6. O painel acompanha o estado e permite descarregar o resultado.

## Limites configuráveis

Os valores predefinidos podem ser alterados por variáveis de ambiente no serviço `projects`:

| Variável | Perfil | Predefinição |
| --- | --- | ---: |
| `VIDEO_MAX_DURATION_FREE` | `free` | 30 segundos |
| `VIDEO_MAX_MB_FREE` | `free` | 50 MB |
| `VIDEO_MAX_HEIGHT_FREE` | `free` | 720 |
| `VIDEO_MAX_DURATION_PREMIUM` | `premium` | 300 segundos |
| `VIDEO_MAX_MB_PREMIUM` | `premium` | 500 MB |
| `VIDEO_MAX_HEIGHT_PREMIUM` | `premium` | 1080 |

Contas `anonymous` não podem usar o processamento de vídeo. Contas `premium` não consomem operações avançadas diárias. Nas contas `free`, a operação reservada é devolvida quando o pedido falha ou é cancelado antes de terminar.

## Testes executados

- `python3 Tools/video_filters/test_cut.py` — 4 testes passaram com FFmpeg/FFprobe disponíveis.
- `node --check` nos ficheiros JavaScript alterados — sintaxe válida.
- `python3 -m py_compile` nos ficheiros Python alterados — compilação válida.

A compilação completa do frontend não foi confirmada neste ambiente porque o ZIP não inclui `frontend/node_modules`; o TypeScript global não consegue resolver as dependências React/Next instaladas pelo projeto.
