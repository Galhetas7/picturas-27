import argparse
import math
import os
import subprocess
import tempfile
from pathlib import Path


# Nome: (filtro FFmpeg, valor predefinido, mínimo, máximo)
FILTROS = {
    "cinzento": ("hue=s=0", None, None, None),
    "brilho": ("eq=brightness={valor}", 0.15, -1.0, 1.0),
    "contraste": ("eq=contrast={valor}", 1.3, 0.0, 2.0),
    "saturacao": ("eq=saturation={valor}", 1.5, 0.0, 3.0),
}


def preparar_filtro(especificacao: str) -> str:
    """
    Converte uma especificação como 'brilho:0.2'
    numa expressão de filtro aceite pelo FFmpeg.
    """

    partes = especificacao.split(":", maxsplit=1)
    nome = partes[0].strip().lower()

    if nome not in FILTROS:
        raise ValueError(f"Filtro não suportado: {nome}")

    expressao, valor_predefinido, minimo, maximo = FILTROS[nome]

    # O filtro de tons de cinza não recebe parâmetros.
    if valor_predefinido is None:
        if len(partes) > 1:
            raise ValueError(
                f"O filtro '{nome}' não aceita parâmetros."
            )
        return expressao

    if len(partes) == 1:
        valor = valor_predefinido
    else:
        try:
            valor = float(partes[1])
        except ValueError as erro:
            raise ValueError(
                f"Parâmetro inválido para '{nome}'."
            ) from erro

    if not math.isfinite(valor):
        raise ValueError("O parâmetro deve ser um número finito.")

    if not minimo <= valor <= maximo:
        raise ValueError(
            f"O parâmetro de '{nome}' deve estar "
            f"entre {minimo} e {maximo}."
        )

    return expressao.format(valor=valor)


def aplicar_filtros(
    entrada: str,
    saida: str,
    filtros: list[str],
) -> None:
    """
    Aplica vários filtros visuais, pela ordem indicada,
    produzindo um novo vídeo MP4/H.264.
    """

    caminho_entrada = Path(entrada).resolve()
    caminho_saida = Path(saida).resolve()

    if not caminho_entrada.is_file():
        raise FileNotFoundError(
            f"O vídeo de entrada não existe: {caminho_entrada}"
        )

    if caminho_entrada.suffix.lower() != ".mp4":
        raise ValueError("O ficheiro de entrada deve ser MP4.")

    if caminho_saida.suffix.lower() != ".mp4":
        raise ValueError("O ficheiro de saída deve ser MP4.")

    if caminho_entrada == caminho_saida:
        raise ValueError(
            "O vídeo original não pode ser substituído."
        )

    if caminho_saida.exists():
        raise FileExistsError(
            f"O ficheiro de saída já existe: {caminho_saida}"
        )

    if not filtros:
        raise ValueError("É necessário indicar pelo menos um filtro.")

    expressoes = [preparar_filtro(filtro) for filtro in filtros]

    # A ordem da lista corresponde à ordem de aplicação.
    cadeia_filtros = ",".join(expressoes)

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)

    # Criamos o resultado numa localização temporária.
    # Só o publicamos depois de o FFmpeg terminar com sucesso.
    with tempfile.NamedTemporaryFile(
        suffix=".mp4",
        prefix=".video_filters_",
        dir=caminho_saida.parent,
        delete=False,
    ) as temporario:
        caminho_temporario = Path(temporario.name)

    comando = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i", str(caminho_entrada),
        "-map", "0:v:0",
        "-map", "0:a?",
        "-vf", cadeia_filtros,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        str(caminho_temporario),
    ]

    try:
        subprocess.run(comando, check=True)

        if not caminho_temporario.is_file():
            raise RuntimeError("O FFmpeg não produziu o resultado.")

        # Publicação apenas após processamento bem-sucedido.
        os.replace(caminho_temporario, caminho_saida)

    finally:
        # Em caso de falha, eliminamos o ficheiro parcial.
        caminho_temporario.unlink(missing_ok=True)


def cortar_video(
    entrada: str,
    saida: str,
    inicio: float,
    fim: float,
    timeout: int = 1800,
) -> None:
    """
    UC-02: extrai o trecho [inicio, fim] (em segundos) de um vídeo,
    produzindo um novo MP4/H.264 com o áudio correspondente.

    O vídeo é recodificado (e não copiado) para que o corte tenha a
    precisão de um fotograma, em vez de parar apenas em keyframes.
    A taxa de fotogramas do original é mantida (não se usa -r).
    """

    caminho_entrada = Path(entrada).resolve()
    caminho_saida = Path(saida).resolve()

    if not caminho_entrada.is_file():
        raise FileNotFoundError(
            f"O vídeo de entrada não existe: {caminho_entrada}"
        )

    if caminho_entrada.suffix.lower() != ".mp4":
        raise ValueError("O ficheiro de entrada deve ser MP4.")

    if caminho_saida.suffix.lower() != ".mp4":
        raise ValueError("O ficheiro de saída deve ser MP4.")

    if caminho_entrada == caminho_saida:
        raise ValueError("O vídeo original não pode ser substituído.")

    if caminho_saida.exists():
        raise FileExistsError(
            f"O ficheiro de saída já existe: {caminho_saida}"
        )

    for valor in (inicio, fim):
        if not math.isfinite(valor):
            raise ValueError("Os instantes devem ser números finitos.")

    if inicio < 0 or inicio >= fim:
        raise ValueError(
            "O instante inicial deve ser menor do que o final."
        )

    if fim - inicio < 1.0:
        raise ValueError("O trecho deve ter pelo menos 1 segundo.")

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        suffix=".mp4",
        prefix=".video_cut_",
        dir=caminho_saida.parent,
        delete=False,
    ) as temporario:
        caminho_temporario = Path(temporario.name)

    comando = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-ss", f"{inicio:.3f}",
        "-i", str(caminho_entrada),
        "-t", f"{fim - inicio:.3f}",
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        str(caminho_temporario),
    ]

    try:
        # timeout = tempo máximo de 30 minutos (RN9).
        subprocess.run(comando, check=True, timeout=timeout)

        if (
            not caminho_temporario.is_file()
            or caminho_temporario.stat().st_size == 0
        ):
            raise RuntimeError("O FFmpeg não produziu o resultado.")

        os.replace(caminho_temporario, caminho_saida)

    finally:
        caminho_temporario.unlink(missing_ok=True)


#UC-01 RN1: intervalo permitido para o fator de velocidade.
FATOR_MINIMO = 0.25
FATOR_MAXIMO = 4.0


def tem_audio(caminho: Path) -> bool:
    """Indica se o vídeo tem pelo menos uma faixa de áudio (A5)."""

    resultado = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=index",
            "-of", "csv=p=0",
            str(caminho),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return resultado.stdout.strip() != ""


def cadeia_atempo(fator: float) -> str:
    """
    UC-01 A5: o filtro atempo altera a duração do áudio sem mudar a
    altura do som. Algumas versões do FFmpeg só aceitam valores entre
    0,5 e 2 por instância, por isso encadeamos várias quando é preciso
    (por exemplo, 4× = atempo=2,atempo=2; 0,25× = atempo=0.5,atempo=0.5).
    """

    partes = []
    restante = fator

    while restante >= 2.0:
        partes.append("atempo=2.0")
        restante /= 2.0

    while restante <= 0.5:
        partes.append("atempo=0.5")
        restante /= 0.5

    if abs(restante - 1.0) > 1e-9:
        partes.append(f"atempo={restante:.6f}")

    return ",".join(partes) if partes else "anull"


def alterar_velocidade(
    entrada: str,
    saida: str,
    fator: float,
    timeout: int = 1800,
) -> None:
    """
    UC-01: produz um novo MP4/H.264 com o vídeo completo acelerado ou
    abrandado pelo fator indicado. A duração do resultado é a duração
    original dividida pelo fator (RN5); o áudio acompanha a nova
    velocidade, mantém-se sincronizado e conserva a altura original
    (A5). A taxa de fotogramas do original é mantida.
    """

    caminho_entrada = Path(entrada).resolve()
    caminho_saida = Path(saida).resolve()

    if not caminho_entrada.is_file():
        raise FileNotFoundError(
            f"O vídeo de entrada não existe: {caminho_entrada}"
        )

    if caminho_entrada.suffix.lower() != ".mp4":
        raise ValueError("O ficheiro de entrada deve ser MP4.")

    if caminho_saida.suffix.lower() != ".mp4":
        raise ValueError("O ficheiro de saída deve ser MP4.")

    if caminho_entrada == caminho_saida:
        raise ValueError("O vídeo original não pode ser substituído.")

    if caminho_saida.exists():
        raise FileExistsError(
            f"O ficheiro de saída já existe: {caminho_saida}"
        )

    if isinstance(fator, bool) or not isinstance(fator, (int, float)):
        raise ValueError("O fator de velocidade deve ser um número.")

    fator = float(fator)

    if not math.isfinite(fator):
        raise ValueError("O fator de velocidade deve ser um número finito.")

    if not FATOR_MINIMO <= fator <= FATOR_MAXIMO:
        raise ValueError(
            f"O fator de velocidade deve estar entre "
            f"{FATOR_MINIMO} e {FATOR_MAXIMO}."
        )

    #FA2: fator 1 não altera o vídeo.
    if abs(fator - 1.0) < 1e-9:
        raise ValueError("O fator 1 não altera o vídeo.")

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(
        suffix=".mp4",
        prefix=".video_speed_",
        dir=caminho_saida.parent,
        delete=False,
    ) as temporario:
        caminho_temporario = Path(temporario.name)

    comando = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i", str(caminho_entrada),
        "-map", "0:v:0",
        "-filter:v", f"setpts=PTS/{fator:.6f}",
    ]

    #A5: vídeos sem áudio são processados normalmente.
    if tem_audio(caminho_entrada):
        comando += [
            "-map", "0:a:0",
            "-filter:a", cadeia_atempo(fator),
            "-c:a", "aac",
            "-b:a", "128k",
        ]

    comando += [
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(caminho_temporario),
    ]

    try:
        # timeout = tempo máximo de 30 minutos (RN9).
        subprocess.run(comando, check=True, timeout=timeout)

        if (
            not caminho_temporario.is_file()
            or caminho_temporario.stat().st_size == 0
        ):
            raise RuntimeError("O FFmpeg não produziu o resultado.")

        os.replace(caminho_temporario, caminho_saida)

    finally:
        caminho_temporario.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Aplicar filtros visuais a vídeos."
    )

    parser.add_argument("entrada")
    parser.add_argument("saida")

    parser.add_argument(
        "--filtro",
        action="append",
        required=True,
        help=(
            "Filtro a aplicar. Pode repetir esta opção. "
            "Exemplos: cinzento, brilho:0.2, contraste:1.3."
        ),
    )

    argumentos = parser.parse_args()

    try:
        aplicar_filtros(
            argumentos.entrada,
            argumentos.saida,
            argumentos.filtro,
        )
    except (
        ValueError,
        FileNotFoundError,
        FileExistsError,
        subprocess.CalledProcessError,
    ) as erro:
        parser.exit(1, f"Erro: {erro}\n")