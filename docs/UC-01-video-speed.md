# UC-01 — Alterar velocidade de um vídeo

Esta alteração acrescenta ao editor de vídeo uma operação que acelera ou abranda o vídeo completo de um projeto, seguindo a mesma arquitetura do corte (UC-02): `projects` → RabbitMQ (`video_filters_queue`) → `video_filters_tool` (FFmpeg) → `video_results_queue`.

## Fluxo

1. No projeto, abre **Vídeos → Velocidade**.
2. Usa o MP4 já associado ao projeto ou seleciona um novo ficheiro para carregar.
3. Escolhe um fator (atalhos 0,25×, 0,5×, 0,75×, 1,5×, 2×, 4× ou um valor livre). O painel mostra a duração estimada do resultado (duração / fator).
4. O serviço `projects` (`POST /:user/:project/video/speed`) valida o fator, o perfil, os limites do vídeo de entrada **e** a duração do resultado, garante uma única execução ativa, reserva uma operação avançada para contas `free` e publica o pedido `video_speed`.
5. O worker executa FFmpeg com `setpts=PTS/fator` no vídeo e uma cadeia `atempo` no áudio, que mantém a sincronização e a altura do som. O resultado é um novo MP4/H.264 com a taxa de fotogramas original; o original não é alterado.
6. O painel acompanha o estado, permite cancelar e descarregar o resultado.

## Rastreabilidade com o caso de uso

| Elemento do UC-01 | Onde está implementado |
| --- | --- |
| RN1 — fator entre 0,25× e 4× | `projects/routes/videoSpeed.js`, `Tools/video_filters/video_filters.py` (`alterar_velocidade`), painel |
| FA2 — fator 1 não cria execução | `videoSpeed.js` (400) e painel (botão desativado) |
| RN2 — MP4/H.264 | `alterar_velocidade` (`libx264`, `yuv420p`) |
| RN3 — limites por perfil na entrada e no resultado | `videoSpeed.js` (duração de entrada, duração do resultado, tamanho, resolução) |
| RN4 — anónimo sem acesso | `videoSpeed.js` (403) |
| RN5 — duração ≈ original / fator | `setpts`/`atempo`; `estimatedDurationSeconds` na resposta 202 |
| RN6 — uma execução ativa | `videoSpeed.js` (409) |
| RN7 — original preservado | ficheiro temporário + `os.replace`; recusa saída igual à entrada |
| RN8 — quota do registado | `reservarOperacoes`/`devolverOperacoes`, igual ao UC-02 |
| RN9 — 30 minutos | `timeout=1800` no `subprocess.run` |
| A5 — áudio sincronizado, altura preservada, vídeos sem áudio | `cadeia_atempo`, `tem_audio` |
| FA1/FA3 — cancelar e retomar o estado | endpoints existentes de `/video/process/:id` reutilizados pelo painel |

## Ficheiros alterados

- `Tools/video_filters/video_filters.py` — `alterar_velocidade`, `cadeia_atempo`, `tem_audio`
- `Tools/video_filters/worker.py` — procedimento `video_speed`
- `Tools/video_filters/test_speed.py` — testes unitários (novo)
- `projects/routes/videoSpeed.js` — rota (novo); `projects/app.js` — registo da rota
- `projects/models/videoProcess.js` — `operation: "speed"` e campo `speed.factor`
- `projects/utils/videoQueue.js` — aceita o procedimento `video_speed`
- `projects/routes/videos.js` — o estado devolve `speed`
- `apiGateway/routes/projects.js` — encaminha `POST /:user/:project/video/speed`
- `frontend/components/project-page/video-speed-panel.tsx` — painel (novo)
- `frontend/app/dashboard/[pid]/page.tsx` — separador **Velocidade**

## Testes executados

- `python3 Tools/video_filters/test_speed.py` — 8 testes passaram (2×, 0,5×, extremos 0,25× e 4×, vídeo sem áudio, original inalterado, fatores inválidos, sem temporários, cadeia `atempo`).
- `python3 Tools/video_filters/test_cut.py` — os 4 testes do UC-02 continuam a passar.
- Simulação do worker com uma mensagem `video_speed` (6 s a 3× → 2,07 s, 30 fps, com áudio) e com fator inválido (resposta `error`).
- Teste da rota `videoSpeed.js` com dependências simuladas — 13 verificações (fator inválido, FA2, RN3 na entrada e no resultado, resolução, anónimo, execução ativa, quota, fluxo principal registado e premium).
- `node --check` nos ficheiros JavaScript alterados.

Não foi possível compilar o frontend (`tsc`/`next build`) no ambiente onde a alteração foi produzida, porque o registo npm não estava acessível. O painel foi derivado do painel do corte e revisto manualmente; deve ser confirmado com `docker compose up -d --build frontend`.

## Apoio de IA

Implementação produzida com o Claude (Anthropic) a partir da especificação do UC-01 no relatório da Fase 1 e do padrão já existente do UC-02. A equipa deve rever o código, correr os testes acima e validar o fluxo na aplicação antes do merge.
