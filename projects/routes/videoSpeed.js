const express = require("express");
const { randomUUID } = require("node:crypto");

const VideoProcess = require("../models/videoProcess");
const { descarregarVideoOriginal } = require("../utils/videoSource");
const { publicarProcessamentoVideo } = require("../utils/videoQueue");
const {
  obterTipoUtilizador,
  operacoesRestantes,
  reservarOperacoes,
  devolverOperacoes,
} = require("../utils/videoQuota");

const { requireVideoOwner } = require("../middleware/videoAuth");
const {
  requireVideoProjectOwner,
} = require("../middleware/videoProjectOwner");
const {
  requireVideoProjectVersion,
} = require("../middleware/videoProjectVersion");

const router = express.Router();

//UC-01 RN1: intervalo permitido para o fator de velocidade.
const FATOR_MINIMO = 0.25;
const FATOR_MAXIMO = 4;

//Tolerância ao comparar a duração medida pelo FFprobe com os limites.
const TOLERANCIA_S = 0.1;

const numero = (valor, omissao) =>
  Number.isFinite(Number(valor)) && Number(valor) > 0
    ? Number(valor)
    : omissao;

//UC-01 RN3: limites do vídeo (entrada e resultado) por perfil (configuráveis por
//variáveis de ambiente, REQ-VID-DEPLOY-103).
const LIMITES = {
  free: {
    nome: "registado",
    duracao: numero(process.env.VIDEO_MAX_DURATION_FREE, 30),
    bytes: numero(process.env.VIDEO_MAX_MB_FREE, 50) * 1024 * 1024,
    altura: numero(process.env.VIDEO_MAX_HEIGHT_FREE, 720),
  },
  premium: {
    nome: "premium",
    duracao: numero(process.env.VIDEO_MAX_DURATION_PREMIUM, 300),
    bytes: numero(process.env.VIDEO_MAX_MB_PREMIUM, 500) * 1024 * 1024,
    altura: numero(process.env.VIDEO_MAX_HEIGHT_PREMIUM, 1080),
  },
};

//O fator é guardado com 3 casas decimais (por exemplo, 1.25).
const arredondar = (x) => Math.round(x * 1000) / 1000;

//UC-01: iniciar a alteração da velocidade de um vídeo.
router.post(
  "/:user/:project/video/speed",
  requireVideoOwner,
  requireVideoProjectOwner,
  requireVideoProjectVersion,
  async (req, res) => {
    const userId = req.params.user;
    const projectId = req.params.project;
    const projeto = req.videoProject;
    const video = projeto?.video;

    const videoKey = video?.original_key;

    if (typeof videoKey !== "string" || videoKey.length === 0) {
      return res.status(400).json({
        message: "O projeto ainda não tem um vídeo original.",
      });
    }

    // --- 1. Validar o fator (passo 2, RN1, FA2) ---
    const { factor } = req.body || {};

    if (typeof factor !== "number" || !Number.isFinite(factor)) {
      return res.status(400).json({
        message: "Indica o fator de velocidade (por exemplo, 2 ou 0.5).",
      });
    }

    if (factor < FATOR_MINIMO || factor > FATOR_MAXIMO) {
      return res.status(400).json({
        message:
          `O fator de velocidade tem de estar entre ${FATOR_MINIMO}× ` +
          `e ${FATOR_MAXIMO}×.`,
      });
    }

    const fator = arredondar(factor);

    //FA2: o fator 1 não altera o vídeo, por isso não se cria execução.
    if (fator === 1) {
      return res.status(400).json({
        message: "Com o fator 1 o vídeo não sofre alteração.",
      });
    }

    const duracaoVideo = Number(video.duration_seconds);

    if (!Number.isFinite(duracaoVideo) || duracaoVideo <= 0) {
      return res.status(400).json({
        message: "Não foi possível determinar a duração do vídeo.",
      });
    }

    //RN5: duração estimada do resultado.
    const duracaoResultado = duracaoVideo / fator;

    // --- 2. Perfil (RN4): o anónimo não tem acesso a vídeo ---
    const tipo = await obterTipoUtilizador(userId);

    if (tipo === null) {
      return res.status(503).json({
        message: "Não foi possível verificar o perfil do utilizador.",
      });
    }

    const limites = LIMITES[tipo];

    if (!limites) {
      return res.status(403).json({
        message:
          "O processamento de vídeo não está disponível para este perfil.",
      });
    }

    // --- 3. Limites do vídeo de entrada e do resultado (passo 4, RN3) ---
    if (duracaoVideo > limites.duracao + TOLERANCIA_S) {
      return res.status(400).json({
        message:
          `O vídeo excede o limite de ${limites.duracao} s do perfil ` +
          `${limites.nome}.` +
          (tipo === "free" ? " Subscreve o premium para vídeos mais longos." : ""),
      });
    }

    //RN3: o limite de duração também se aplica ao vídeo resultante
    //(abrandar 30 s a 0,5× daria 60 s, acima do limite do registado).
    if (duracaoResultado > limites.duracao + TOLERANCIA_S) {
      return res.status(400).json({
        message:
          `O vídeo resultante teria ${duracaoResultado.toFixed(1)} s e ` +
          `excede o limite de ${limites.duracao} s do perfil ${limites.nome}.` +
          (tipo === "free" ? " Subscreve o premium para vídeos mais longos." : ""),
      });
    }

    if (video.size_bytes > limites.bytes) {
      return res.status(400).json({
        message:
          `O vídeo excede o limite de ` +
          `${Math.round(limites.bytes / (1024 * 1024))} MB do perfil ` +
          `${limites.nome}.` +
          (tipo === "free" ? " Subscreve o premium para vídeos maiores." : ""),
      });
    }

    if (Math.min(video.width, video.height) > limites.altura) {
      return res.status(400).json({
        message:
          `O vídeo excede a resolução máxima de ${limites.altura}p do ` +
          `perfil ${limites.nome}.` +
          (tipo === "free" ? " Subscreve o premium para resoluções maiores." : ""),
      });
    }

    // --- 4. Uma execução ativa por utilizador e por projeto (RN6) ---
    //NOTA: esta verificação não é atómica; para o MVP chega. Para
    //garantir exclusividade total, use um índice único parcial.
    const ativa = await VideoProcess.findOne({
      user_id: userId,
      status: { $in: ["pending", "processing"] },
    }).lean();

    if (ativa) {
      const mesmoProjeto = String(ativa.project_id) === projectId;

      return res.status(409).json({
        message: mesmoProjeto
          ? "Já existe um processamento em curso neste projeto. Cancela-o ou espera que termine."
          : "Já tens um processamento de vídeo em curso noutro projeto.",
        processId: String(ativa._id),
        projectId: String(ativa.project_id),
      });
    }

    // --- 5. Quota (RN8): a velocidade é uma operação avançada ---
    const messageId = randomUUID();
    let reservadas = 0;
    let processo = null;
    let processoGuardado = false;
    let publicacaoIniciada = false;
    let publicado = false;

    try {
      if (tipo === "free") {
        const reserva = await reservarOperacoes(userId, 1);

        if (!reserva.ok) {
          if (reserva.motivo === "quota") {
            const restantes = await operacoesRestantes(userId);

            return res.status(403).json({
              message:
                "Já usaste todas as operações avançadas de hoje" +
                (restantes !== null ? ` (restam ${restantes})` : "") +
                ". Subscreve o premium ou volta amanhã.",
            });
          }

          return res.status(503).json({
            message: "Não foi possível verificar a quota diária.",
          });
        }

        reservadas = 1;
      }

      // --- 6. Criar a execução e publicar o pedido ---
      processo = new VideoProcess({
        user_id: userId,
        project_id: projectId,
        msg_id: messageId,
        status: "pending",
        operation: "speed",
        speed: { factor: fator },
        reserved_ops: reservadas,
        input_video_key: videoKey,
      });

      await processo.save();
      processoGuardado = true;

      const caminhos = await descarregarVideoOriginal(
        userId,
        projectId,
        videoKey,
        messageId
      );

      publicacaoIniciada = true;

      await publicarProcessamentoVideo({
        messageId,
        timestamp: new Date().toISOString(),
        procedure: "video_speed",
        parameters: {
          inputVideoURI: caminhos.inputVideoURI,
          outputVideoURI: caminhos.outputVideoURI,
          factor: fator,
        },
      });

      publicado = true;

      return res.status(202).json({
        message: "Alteração de velocidade aceite.",
        processId: String(processo._id),
        messageId,
        status: "pending",
        operation: "speed",
        factor: fator,
        estimatedDurationSeconds: arredondar(duracaoResultado),
      });
    } catch (erro) {
      console.error(
        "[VIDEO SPEED] Não foi possível iniciar a alteração de velocidade:",
        erro.message
      );

      //Publicação incerta: não devolver a quota, a mensagem pode ter chegado ao worker.
      if (processo && publicacaoIniciada && !publicado) {
        return res.status(503).json({
          message:
            "Não foi possível confirmar a publicação. " +
            "Consulta o estado antes de tentares novamente.",
          processId: String(processo._id),
          messageId,
          status: "pending",
          publicationUncertain: true,
        });
      }

      //O pedido nunca saiu: marcar como falhado e devolver a quota.
      try {
        if (processoGuardado && processo) {
          const falhado = await VideoProcess.findOneAndUpdate(
            { _id: processo._id, status: "pending" },
            {
              $set: {
                status: "failed",
                error_message:
                  "Não foi possível preparar o vídeo para processamento.",
                finished_at: new Date(),
              },
            },
            { new: true }
          );

          // Só devolver quando esta operação ganhou a transição para failed.
          // Se já foi cancelada, o endpoint de cancelamento já tratou da quota.
          if (falhado && falhado.reserved_ops > 0) {
            await devolverOperacoes(userId, falhado.reserved_ops);
          }
        } else if (reservadas > 0) {
          // A reserva ocorreu, mas não chegou a existir documento no MongoDB.
          await devolverOperacoes(userId, reservadas);
        }
      } catch (erroLimpeza) {
        console.error("[VIDEO SPEED] Erro ao repor o estado:", erroLimpeza.message);
      }

      return res.status(503).json({
        message: "Não foi possível preparar o vídeo para processamento.",
      });
    }
  }
);

module.exports = router;
