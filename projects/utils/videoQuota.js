const axios = require("axios");
const { httpsAgent } = require("./httpsAgent");

//UC-02: comunicação do vídeo com o serviço users (quota diária).
const USERS_MS = process.env.USERS_MS || "https://users:10001/";

//Devolve "free", "premium", "anonymous" ou null se o serviço falhar.
async function obterTipoUtilizador(userId) {
  try {
    const resposta = await axios.get(`${USERS_MS}${userId}/type`, {
      httpsAgent,
      timeout: 5000,
    });

    return resposta.data?.type ?? null;
  } catch (erro) {
    console.error("[VIDEO QUOTA] Falha ao obter o tipo:", erro.message);
    return null;
  }
}

//Operações diárias que ainda restam ao utilizador (null se desconhecido).
async function operacoesRestantes(userId) {
  try {
    const resposta = await axios.get(`${USERS_MS}${userId}`, {
      httpsAgent,
      timeout: 5000,
    });

    const restantes = resposta.data?.remaining_operations;
    return Number.isFinite(restantes) ? restantes : null;
  } catch (_) {
    return null;
  }
}

//Reserva n operações avançadas. O serviço users devolve 701 quando
//a quota acabou (e também em erros internos, por isso olhamos ao corpo).
async function reservarOperacoes(userId, n) {
  try {
    await axios.get(`${USERS_MS}${userId}/process/${n}`, {
      httpsAgent,
      timeout: 10000,
    });

    return { ok: true };
  } catch (erro) {
    const corpo = String(erro.response?.data ?? "");

    if (erro.response?.status === 701 && corpo.includes("No more")) {
      return { ok: false, motivo: "quota" };
    }

    console.error("[VIDEO QUOTA] Falha na reserva:", erro.message);
    return { ok: false, motivo: "indisponivel" };
  }
}

//Devolve n operações reservadas. Nunca lança: uma falha aqui não deve
//impedir o cancelamento ou o registo da falha da execução.
async function devolverOperacoes(userId, n) {
  if (!Number.isInteger(n) || n <= 0) return true;

  try {
    await axios.post(
      `${USERS_MS}${userId}/process/refund/${n}`,
      {},
      { httpsAgent, timeout: 10000 }
    );

    return true;
  } catch (erro) {
    console.error(
      `[VIDEO QUOTA] Não foi possível devolver ${n} operação(ões) a ${userId}:`,
      erro.message
    );
    return false;
  }
}

module.exports = {
  obterTipoUtilizador,
  operacoesRestantes,
  reservarOperacoes,
  devolverOperacoes,
};
