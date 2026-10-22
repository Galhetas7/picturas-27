"""Testes do UC-02 (corte). Executar: python test_cut.py  (requer ffmpeg/ffprobe)."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from video_filters import cortar_video


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


class TesteCorte(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.original = Path(cls.dir.name) / "original.mp4"
        # vídeo de 10 s, 30 fps, 320x240, com áudio
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=duration=10:size=320x240:rate=30",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
             "-shortest", str(cls.original)],
            check=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_fluxo_principal(self):
        saida = Path(self.dir.name) / "corte.mp4"
        cortar_video(str(self.original), str(saida), 2.0, 5.0)

        info = ffprobe(saida)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        orig = ffprobe(self.original)
        video_orig = next(s for s in orig["streams"] if s["codec_type"] == "video")

        self.assertAlmostEqual(float(info["format"]["duration"]), 3.0, delta=0.15)
        self.assertEqual(video["codec_name"], "h264")
        self.assertAlmostEqual(fps(video), fps(video_orig), places=2)
        self.assertTrue(any(s["codec_type"] == "audio" for s in info["streams"]))

    def test_original_nao_e_alterado(self):
        antes = self.original.read_bytes()
        cortar_video(str(self.original), str(Path(self.dir.name) / "c2.mp4"), 0, 4)
        self.assertEqual(antes, self.original.read_bytes())

    def test_intervalos_invalidos(self):
        saida = str(Path(self.dir.name) / "x.mp4")
        for inicio, fim in [(5, 5), (6, 2), (-1, 3), (1, 1.5)]:
            with self.assertRaises(ValueError):
                cortar_video(str(self.original), saida, inicio, fim)
        self.assertFalse(Path(saida).exists())

    def test_nao_deixa_temporarios(self):
        saida = Path(self.dir.name) / "t" / "corte.mp4"
        cortar_video(str(self.original), str(saida), 1, 3)
        restos = [p.name for p in saida.parent.iterdir() if p.name.startswith(".video_cut_")]
        self.assertEqual(restos, [])


if __name__ == "__main__":
    unittest.main()
