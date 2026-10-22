"""Testes do UC-01 (alterar velocidade). Executar: python test_speed.py  (requer ffmpeg/ffprobe)."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from video_filters import alterar_velocidade, cadeia_atempo


def ffprobe(caminho):
    saida = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format",
         "-of", "json", str(caminho)],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(saida)


def fps(stream):
    num, den = stream["r_frame_rate"].split("/")
    return float(num) / float(den)


def stream(info, tipo):
    return next((s for s in info["streams"] if s["codec_type"] == tipo), None)


def duracao_stream(info, tipo):
    s = stream(info, tipo)
    return float(s["duration"]) if s and "duration" in s else None


class TesteVelocidade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.original = Path(cls.dir.name) / "original.mp4"
        cls.sem_audio = Path(cls.dir.name) / "sem_audio.mp4"
        # vídeo de 8 s, 30 fps, 320x240, com áudio de 440 Hz
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=duration=8:size=320x240:rate=30",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
             "-shortest", str(cls.original)],
            check=True,
        )
        # o mesmo vídeo sem faixa de áudio (A5)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=25",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", str(cls.sem_audio)],
            check=True,
        )
        cls.info_original = ffprobe(cls.original)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def _verificar(self, fator, nome):
        saida = Path(self.dir.name) / nome
        alterar_velocidade(str(self.original), str(saida), fator)

        info = ffprobe(saida)
        video = stream(info, "video")
        video_orig = stream(self.info_original, "video")

        # RN5: duração ≈ duração original / fator
        esperado = float(self.info_original["format"]["duration"]) / fator
        self.assertAlmostEqual(float(info["format"]["duration"]), esperado,
                               delta=max(0.15, esperado * 0.03))
        # RN2: H.264; RN7 do UC-02 aplicado também aqui: mesma taxa de fotogramas
        self.assertEqual(video["codec_name"], "h264")
        self.assertAlmostEqual(fps(video), fps(video_orig), places=2)
        # A5: áudio presente e sincronizado (diferença de duração pequena)
        self.assertIsNotNone(stream(info, "audio"))
        dv, da = duracao_stream(info, "video"), duracao_stream(info, "audio")
        self.assertAlmostEqual(dv, da, delta=0.2)
        return info

    def test_acelerar_2x(self):
        self._verificar(2.0, "x2.mp4")

    def test_abrandar_0_5x(self):
        self._verificar(0.5, "x05.mp4")

    def test_limites_do_intervalo(self):
        # RN1: os extremos 0,25× e 4× são aceites
        self._verificar(4.0, "x4.mp4")
        self._verificar(0.25, "x025.mp4")

    def test_video_sem_audio(self):
        saida = Path(self.dir.name) / "sem_audio_x2.mp4"
        alterar_velocidade(str(self.sem_audio), str(saida), 2.0)
        info = ffprobe(saida)
        self.assertIsNone(stream(info, "audio"))
        self.assertAlmostEqual(float(info["format"]["duration"]), 2.0, delta=0.15)

    def test_original_nao_e_alterado(self):
        antes = self.original.read_bytes()
        alterar_velocidade(str(self.original), str(Path(self.dir.name) / "o.mp4"), 1.5)
        self.assertEqual(antes, self.original.read_bytes())

    def test_fatores_invalidos(self):
        saida = str(Path(self.dir.name) / "invalido.mp4")
        for fator in [0, -1, 0.2, 4.5, 1.0, float("nan"), float("inf"), True, "2"]:
            with self.assertRaises(ValueError, msg=f"fator={fator!r}"):
                alterar_velocidade(str(self.original), saida, fator)
        self.assertFalse(Path(saida).exists())

    def test_nao_deixa_temporarios(self):
        saida = Path(self.dir.name) / "t" / "vel.mp4"
        alterar_velocidade(str(self.original), str(saida), 2.0)
        restos = [p.name for p in saida.parent.iterdir() if p.name.startswith(".video_speed_")]
        self.assertEqual(restos, [])

    def test_cadeia_atempo(self):
        self.assertEqual(cadeia_atempo(4.0), "atempo=2.0,atempo=2.0")
        self.assertEqual(cadeia_atempo(0.25), "atempo=0.5,atempo=0.5")
        self.assertEqual(cadeia_atempo(1.5), "atempo=1.500000")


if __name__ == "__main__":
    unittest.main()
