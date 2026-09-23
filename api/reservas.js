// API da lista de presentes — Vercel Function (Node.js)
// GET    /api/reservas            -> { reservas: { slug: {nome, ts} }, total }
// POST   /api/reservas            -> body { slug, nome, token }   reserva um item
// DELETE /api/reservas            -> body { slug, token, senha }  devolve um item

// A Vercel/Upstash injeta as credenciais com nomes que variam conforme a
// integração. Aceitamos todos os nomes possíveis para não quebrar o deploy.
const REST_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_URL ||
  "";

const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_TOKEN ||
  "";

const SENHA_ADMIN = process.env.SENHA_ADMIN || "";
const CHAVE = "chadecasanova:reservas";

// Itens válidos. Só estes slugs podem ser gravados.
const ITENS = {
  "tapete-banheiro": "Tapete para banheiro",
  "desentupidor-pia": "Desentupidor de pia",
  "escova-vaso": "Escova para vaso sanitário",
  "espelho": "Espelho",
  "porta-sabonete": "Porta-sabonete",
  "tapete-box": "Tapete antiderrapante para box",
  "frigideiras": "Frigideiras",
  "potes-hermeticos": "Potes herméticos",
  "centrifuga-salada": "Centrífuga de salada",
  "chaleira": "Chaleira",
  "escorredor-louca": "Escorredor de louça",
  "espremedor-fruta": "Espremedor de fruta",
  "moedor-tempero": "Moedor de tempero",
  "puxa-saco": "Puxa-saco",
  "xicara-medidora": "Xícara medidora",
  "travessas-servir": "Travessas para servir",
  "balde-pinca-gelo": "Balde e pinça de gelo",
  "tanquinho": "Tanquinho",
  "micro-ondas": "Micro-ondas",
  "liquidificador": "Liquidificador",
  "cafeteira": "Cafeteira",
  "sanduicheira": "Sanduicheira",
  "processador-frutas": "Processador de frutas",
  "ferro-passar": "Ferro de passar",
  "esfregao": "Esfregão",
  "flanela": "Flanela",
  "pa-de-lixo": "Pá de lixo",
  "pano-de-chao": "Pano de chão",
  "rodo": "Rodo",
  "vassoura": "Vassoura",
  "espanador-po": "Espanador de pó",
  "tabua-passar": "Tábua de passar roupa",
  "varal-chao": "Varal de chão",
  "jogo-cama-casal": "Jogo de cama casal",
  "lencol": "Lençol",
  "fronha": "Fronha",
  "travesseiros": "Travesseiros",
  "cabide": "Cabide",
  "cortina-neutra": "Cortina em cor neutra",
  "capacho": "Capacho",
  "almofadas-decorativas": "Almofadas decorativas",
  "almofada-neutra": "Almofada em cor neutra",
  "luminaria": "Luminária",
  "difusor-aroma": "Difusor de aroma",
  "relogio-parede": "Relógio de parede"
};

async function redis(comando) {
  const resposta = await fetch(REST_URL.replace(/\/+$/, ""), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + REST_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(comando)
  });

  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error("Redis respondeu " + resposta.status + ": " + texto.slice(0, 200));
  }

  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (e) {
    throw new Error("Resposta do Redis não é JSON: " + texto.slice(0, 200));
  }
  if (dados && dados.error) throw new Error(String(dados.error));
  return dados ? dados.result : null;
}

// O HGETALL da REST API devolve um array plano [campo, valor, campo, valor...].
// Alguns provedores devolvem objeto. Aceitamos as duas formas.
function paraObjeto(resultado) {
  if (!resultado) return {};
  if (Array.isArray(resultado)) {
    const obj = {};
    for (let i = 0; i + 1 < resultado.length; i += 2) {
      obj[resultado[i]] = resultado[i + 1];
    }
    return obj;
  }
  if (typeof resultado === "object") return resultado;
  return {};
}

function limparNome(valor) {
  return String(valor == null ? "" : valor)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const pedacos = [];
  for await (const pedaco of req) pedacos.push(pedaco);
  if (!pedacos.length) return {};
  try { return JSON.parse(Buffer.concat(pedacos).toString("utf8")); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!REST_URL || !REST_TOKEN) {
    return res.status(500).json({
      erro: "banco_nao_configurado",
      mensagem:
        "O banco Redis não está conectado. No painel da Vercel, confira se as variáveis KV_REST_API_URL e KV_REST_API_TOKEN existem no projeto e refaça o deploy."
    });
  }

  try {
    // ---------- listar ----------
    if (req.method === "GET") {
      const bruto = paraObjeto(await redis(["HGETALL", CHAVE]));
      const reservas = {};
      for (const slug of Object.keys(bruto)) {
        if (!ITENS[slug]) continue;
        let corpo = bruto[slug];
        if (typeof corpo === "string") {
          try { corpo = JSON.parse(corpo); } catch (e) { corpo = { nome: corpo }; }
        }
        if (corpo && corpo.nome) {
          reservas[slug] = { nome: corpo.nome, ts: corpo.ts || null };
        }
      }
      return res.status(200).json({ reservas: reservas, total: Object.keys(ITENS).length });
    }

    // ---------- reservar ----------
    if (req.method === "POST") {
      const corpo = await lerCorpo(req);
      const slug = String(corpo.slug || "");
      const nome = limparNome(corpo.nome);
      const token = String(corpo.token || "").slice(0, 64);

      if (!ITENS[slug]) {
        return res.status(400).json({ erro: "item_invalido", mensagem: "Esse item não está na lista." });
      }
      if (!nome) {
        return res.status(400).json({ erro: "sem_nome", mensagem: "Escreva seu nome antes de escolher." });
      }

      const registro = JSON.stringify({ nome: nome, ts: Date.now(), token: token });

      // HSETNX é atômico: grava só se o campo ainda não existir.
      // É isso que impede duas pessoas de pegarem o mesmo item.
      const gravou = await redis(["HSETNX", CHAVE, slug, registro]);

      if (Number(gravou) === 1) {
        return res.status(200).json({ ok: true, slug: slug, nome: nome, item: ITENS[slug] });
      }

      let atual = await redis(["HGET", CHAVE, slug]);
      if (typeof atual === "string") {
        try { atual = JSON.parse(atual); } catch (e) { atual = { nome: atual }; }
      }
      return res.status(409).json({
        erro: "ja_reservado",
        por: (atual && atual.nome) || "outra pessoa",
        mensagem: ITENS[slug] + " acabou de ser escolhido. Escolha outro item."
      });
    }

    // ---------- devolver ----------
    if (req.method === "DELETE") {
      const corpo = await lerCorpo(req);
      const slug = String(corpo.slug || "");
      const token = String(corpo.token || "").slice(0, 64);
      const senha = String(corpo.senha || "");

      if (!ITENS[slug]) {
        return res.status(400).json({ erro: "item_invalido", mensagem: "Esse item não está na lista." });
      }

      let atual = await redis(["HGET", CHAVE, slug]);
      if (atual == null) return res.status(200).json({ ok: true, slug: slug });
      if (typeof atual === "string") {
        try { atual = JSON.parse(atual); } catch (e) { atual = { nome: atual }; }
      }

      const ehDono = token && atual.token && token === atual.token;
      const ehAdmin = SENHA_ADMIN && senha === SENHA_ADMIN;
      if (!ehDono && !ehAdmin) {
        return res.status(403).json({
          erro: "sem_permissao",
          mensagem: "Só quem escolheu este item pode devolvê-lo."
        });
      }

      await redis(["HDEL", CHAVE, slug]);
      return res.status(200).json({ ok: true, slug: slug });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ erro: "metodo_nao_permitido" });
  } catch (e) {
    console.error("Falha na API da lista:", e);
    return res.status(502).json({
      erro: "falha_no_banco",
      mensagem: "Não consegui falar com o banco de dados. Tente de novo em alguns segundos."
    });
  }
};
