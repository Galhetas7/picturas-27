"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  Film,
  LoaderCircle,
  Play,
  Scissors,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { api } from "@/lib/axios";
import { retirarVideoPendente } from "@/lib/pending-video";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type ProcessState = {
  processId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  operation?: string;
  cut?: { start_seconds?: number; end_seconds?: number };
  outputVideoKey?: string | null;
  errorMessage?: string | null;
};

function errorText(err: unknown) {
  if (axios.isAxiosError(err)) {
    const value = err.response?.data?.message;
    return typeof value === "string" ? value : err.message;
  }
  return err instanceof Error ? err.message : "Ocorreu um erro inesperado.";
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const statusLabel: Record<ProcessState["status"], string> = {
  pending: "Na fila",
  processing: "A processar",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function VideoCutPanel({
  userId,
  projectId,
  token,
  version,
  serverDuration,
  onUploaded,
}: {
  userId: string;
  projectId: string;
  token: string;
  version: number;
  serverDuration: number | null;
  onUploaded: () => Promise<unknown> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(serverDuration);
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState(serverDuration ? String(Math.floor(serverDuration)) : "");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ProcessState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const currentVersion = useRef(version);
  const resultUrlRef = useRef<string | null>(null);
  const alive = useRef(true);
  const base = `projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/video`;
  const headers = { Authorization: `Bearer ${token}` };
  const running = !!state && ["pending", "processing"].includes(state.status);
  const selectedDuration = file ? duration : serverDuration ?? duration;
  const startSeconds = Number(start);
  const endSeconds = Number(end);
  const validRange = selectedDuration != null && Number.isFinite(startSeconds) && Number.isFinite(endSeconds) &&
    startSeconds >= 0 && endSeconds > startSeconds && endSeconds - startSeconds >= 1 &&
    endSeconds <= selectedDuration + 0.1;

  useEffect(() => { currentVersion.current = version; }, [version]);
  useEffect(() => {
    if (file) return;
    setDuration(serverDuration);
    if (serverDuration != null && end === "") setEnd(String(Math.floor(serverDuration)));
  }, [serverDuration, file, end]);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => () => {
    alive.current = false;
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
  }, []);

  useEffect(() => {
    const pending = retirarVideoPendente();
    if (pending) chooseFile(pending);
    // O vídeo pendente é consumido apenas ao abrir o editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const key = `picturas-uc02-process:${projectId}`;
    const processId = window.localStorage.getItem(key);
    if (!processId || !/^[a-f0-9]{24}$/i.test(processId)) return;
    let active = true;
    api.get<ProcessState>(`${base}/process/${encodeURIComponent(processId)}`, { headers })
      .then(response => { if (active) setState(response.data); })
      .catch(() => { if (active) window.localStorage.removeItem(key); });
    return () => { active = false; };
    // Recuperar apenas o processo mais recente ao abrir o editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, token]);

  useEffect(() => {
    if (!state || !running) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get<ProcessState>(`${base}/process/${encodeURIComponent(state.processId)}`, { headers });
        if (!stopped && alive.current) {
          setState(response.data);
          if (response.data.status === "completed") setNotice("Corte concluído. O MP4 está disponível para descarregar.");
          if (["failed", "cancelled"].includes(response.data.status)) {
            window.localStorage.removeItem(`picturas-uc02-process:${projectId}`);
          }
        }
      } catch (err) {
        if (!stopped && alive.current) setError(`Não foi possível consultar o estado: ${errorText(err)}`);
      }
    }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [base, projectId, state?.processId, state?.status, token, running]);

  function clearResult() {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResultUrl(null);
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".mp4") || (next.type && next.type !== "video/mp4")) {
      setError("O formato suportado é MP4 com codec H.264.");
      return;
    }
    if (next.size > 500 * 1024 * 1024) {
      setError("O vídeo não pode exceder 500 MB. O limite efetivo depende do teu perfil.");
      return;
    }
    clearResult();
    setError("");
    setNotice("");
    setFile(next);
    setUploadedKey(null);
    setState(null);
    setDuration(null);
    setStart("0");
    setEnd("");
  }

  async function uploadToServer(videoFile: File) {
    const form = new FormData();
    form.append("file", videoFile);
    const response = await api.post(`${base}`, form, {
      headers: { ...headers, "X-Project-Version": String(currentVersion.current) },
      timeout: 180000,
    });
    const newVersion = Number(response.data?.projectVersion ?? response.headers["x-project-version"]);
    if (Number.isFinite(newVersion)) currentVersion.current = newVersion;
    setUploadedKey(fileKey(videoFile));
    await onUploaded();
  }

  async function startCut() {
    if (busy || running) return;
    if (!file && serverDuration == null) {
      setError("Escolhe um vídeo MP4 para o carregar para o projeto.");
      return;
    }
    if (!validRange) {
      setError("Indica um intervalo válido de pelo menos 1 segundo, dentro da duração do vídeo.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      if (file && uploadedKey !== fileKey(file)) {
        setNotice("A carregar o vídeo para o projeto...");
        await uploadToServer(file);
      }
      setNotice("A enviar o pedido de corte...");
      const response = await api.post<ProcessState>(`${base}/cut`, {
        start: startSeconds,
        end: endSeconds,
      }, {
        headers: { ...headers, "X-Project-Version": String(currentVersion.current) },
        timeout: 180000,
      });
      clearResult();
      setState(response.data);
      window.localStorage.setItem(`picturas-uc02-process:${projectId}`, response.data.processId);
      setNotice("Pedido enviado. O estado será atualizado automaticamente.");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.publicationUncertain && err.response.data.processId) {
        setState({ processId: err.response.data.processId, status: "pending" });
        window.localStorage.setItem(`picturas-uc02-process:${projectId}`, err.response.data.processId);
        setNotice("A publicação ainda não foi confirmada; vamos acompanhar o estado antes de repetir.");
      } else {
        setNotice("");
        setError(errorText(err));
      }
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!state) return;
    setBusy(true); setError("");
    try {
      const response = await api.delete<ProcessState>(`${base}/process/${encodeURIComponent(state.processId)}`, { headers });
      setState(old => old ? { ...old, status: response.data.status } : null);
      setNotice("Pedido cancelado no servidor.");
      window.localStorage.removeItem(`picturas-uc02-process:${projectId}`);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  async function downloadResult() {
    if (!state || state.status !== "completed") return;
    setBusy(true); setError("");
    try {
      let url = resultUrlRef.current;
      if (!url) {
        const response = await api.get<Blob>(`${base}/process/${encodeURIComponent(state.processId)}/result`, {
          headers, responseType: "blob", timeout: 180000,
        });
        if (!response.data || response.data.size === 0) throw new Error("O resultado recebido está vazio.");
        url = URL.createObjectURL(new Blob([response.data], { type: "video/mp4" }));
        resultUrlRef.current = url;
        setResultUrl(url);
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `picturas-corte-${state.processId}.mp4`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (err) { setError(`Não foi possível descarregar o vídeo: ${errorText(err)}`); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="Editor de corte de vídeo" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Scissors className="size-5" /></span>
          <div className="min-w-0"><h2 className="font-semibold leading-tight">Cortar vídeo</h2><p className="text-xs text-muted-foreground">UC-02 · Seleciona o trecho a manter · Exportação MP4/H.264</p></div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border px-3 py-1.5">Mínimo: 1 segundo</span>
          {state && <span role="status" className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 font-medium text-foreground">{statusLabel[state.status]}</span>}
        </div>
      </header>

      <main className="grid min-w-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4 bg-muted/20 p-4 md:p-6">
          <div><h3 className="text-sm font-semibold">{resultUrl ? "Resultado do corte" : "Pré-visualização"}</h3><p className="text-xs text-muted-foreground">Define os instantes inicial e final do trecho que queres guardar.</p></div>
          <div className="flex min-h-56 w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border bg-zinc-950 p-3">
            {resultUrl || previewUrl ? <video src={resultUrl ?? previewUrl ?? undefined} className="block h-auto max-h-[55vh] w-full max-w-full rounded-md object-contain" controls playsInline preload="metadata" aria-label={resultUrl ? "Pré-visualização do vídeo cortado" : "Pré-visualização do vídeo original"} onLoadedMetadata={event => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value)) {
                setDuration(value);
                if (end === "") setEnd(String(Math.floor(value)));
              }
            }} /> : <div className="flex max-w-sm flex-col items-center gap-3 text-center text-zinc-300"><span className="rounded-2xl bg-white/10 p-5"><Video className="size-10" /></span><p className="text-base font-medium text-white">Escolhe um MP4 para começar</p><p className="text-sm text-zinc-400">Se já existe um vídeo no projeto, podes cortar diretamente esse original.</p><Button type="button" variant="secondary" onClick={() => picker.current?.click()}><UploadCloud className="mr-2 size-4" />Selecionar MP4</Button></div>}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted"><Film className="size-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file?.name ?? (serverDuration != null ? "Vídeo já associado ao projeto" : "Nenhum vídeo selecionado")}</p><p className="text-xs text-muted-foreground">{selectedDuration != null ? `Duração: ${formatTime(selectedDuration)} (${selectedDuration.toFixed(2)} s)` : "MP4/H.264 · máximo 500 MB, sujeito ao perfil"}</p></div>
              {file && uploadedKey === fileKey(file) && <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" />Carregado</span>}
              <Button type="button" size="sm" variant="outline" disabled={busy || running} onClick={() => picker.current?.click()}>{file ? "Trocar vídeo" : "Escolher vídeo"}</Button>
            </div>
          </div>
        </div>

        <aside className="min-w-0 border-t bg-card lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2 border-b px-5 py-4"><Scissors className="size-4 text-primary" /><h3 className="text-sm font-semibold">Intervalo do corte</h3></div>
          <div className="space-y-5 p-4">
            <div className="space-y-2"><label htmlFor="video-cut-start" className="text-sm font-medium">Início (segundos)</label><input id="video-cut-start" type="number" min="0" step="0.1" inputMode="decimal" value={start} disabled={busy || running} onChange={event => setStart(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><p className="text-xs text-muted-foreground">Exemplo: 2.5 começa aos 2,5 segundos.</p></div>
            <div className="space-y-2"><label htmlFor="video-cut-end" className="text-sm font-medium">Fim (segundos)</label><input id="video-cut-end" type="number" min="0" step="0.1" max={selectedDuration ?? undefined} inputMode="decimal" value={end} disabled={busy || running} onChange={event => setEnd(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><p className="text-xs text-muted-foreground">O instante final não pode ultrapassar a duração do vídeo.</p></div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="font-medium">Duração do resultado</p><p className="mt-1 text-muted-foreground">{validRange ? `${(endSeconds - startSeconds).toFixed(2)} segundos` : "Indica um intervalo válido"}</p></div>
            <div className="rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground">O vídeo original é preservado. O corte cria um novo MP4 e, para manter a precisão do intervalo, o vídeo é recodificado.</div>
          </div>
        </aside>
      </main>

      <footer className="shrink-0 border-t bg-card px-4 pb-8 pt-4 md:px-6">
        {state && <div className="mb-3 space-y-2"><div className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-2 font-medium">{running ? <LoaderCircle className="size-3.5 animate-spin" /> : state.status === "completed" ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Clock3 className="size-3.5" />}{statusLabel[state.status]}</span>{typeof state.progress === "number" && <span className="tabular-nums text-muted-foreground">{state.progress}%</span>}</div><Progress value={typeof state.progress === "number" ? state.progress : running ? 12 : state.status === "completed" ? 100 : 0} className="h-1.5" /></div>}
        {error && <p className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
        {state?.status === "failed" && <p className="mb-3 text-sm text-destructive" role="alert">{state.errorMessage || "O corte falhou."}</p>}
        {state?.status === "completed" && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3"><span className="mr-auto text-sm">O MP4 cortado está disponível.</span><Button type="button" disabled={busy} onClick={() => void downloadResult()}><Download className="mr-2 size-4" />Descarregar MP4</Button></div>}
        {notice && <p className="mb-3 text-xs text-muted-foreground" role="status">{notice}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Escolher vídeo → definir intervalo → cortar e descarregar</p><div className="flex flex-wrap items-center gap-2">{running && <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}><X className="mr-2 size-4" />Cancelar</Button>}<Button type="button" variant="outline" disabled={!file || busy || running || uploadedKey === (file ? fileKey(file) : null)} onClick={async () => {
          if (!file) return;
          setBusy(true); setError(""); setNotice("A carregar vídeo para o projeto...");
          try { await uploadToServer(file); setNotice("Vídeo carregado. Já podes cortar o trecho."); }
          catch (err) { setNotice(""); setError(errorText(err)); }
          finally { setBusy(false); }
        }}><UploadCloud className="mr-2 size-4" />Carregar vídeo</Button><Button type="button" disabled={busy || running || !validRange || (!file && serverDuration == null)} onClick={() => void startCut()}>{busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}Cortar vídeo</Button></div></div>
      </footer>
      <input ref={picker} type="file" accept=".mp4,video/mp4" className="sr-only" aria-label="Selecionar vídeo MP4" disabled={busy || running} onChange={event => { chooseFile(event.target.files?.[0] || null); event.currentTarget.value = ""; }} />
    </section>
  );
}
