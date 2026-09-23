/* =====================================================
       1. ARMAZENAMENTO (mesmas chaves das páginas antigas,
          então os dados já salvos continuam funcionando)
       ===================================================== */
const KEYS = {
  estoque: "stockDatabase",
  proximoIdEstoque: "nextStockId",
  receitas: "receitas",
  nomesProdutos: "productNames",
  proximoIdProduto: "nextProductId",
  historico: "historicoMovimentacoes",
};

const store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn(`Falha ao ler "${key}":`, e);
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`Falha ao salvar "${key}":`, e);
    }
  },
};

const SUGESTOES_PADRAO = [
  "Arroz",
  "Feijão",
  "Macarrão",
  "Óleo",
  "Açúcar",
  "Sal",
  "Farinha de Trigo",
  "Café",
  "Leite",
  "Manteiga",
  "Queijo",
  "Carne Bovina",
  "Frango",
  "Peixe",
  "Legumes",
  "Frutas",
];

const PRODUTOS_PADRAO = {
  nomes: { 1: "SALGADOS FRITOS", 2: "SALGADOS ASSADOS" },
  receitas: {
    1: {
      FARINHA: { quantity: 1000, unit: "g" },
      QUEIJO: { quantity: 500, unit: "g" },
      ÓLEO: { quantity: 0.5, unit: "L" },
    },
    2: {
      FARINHA: { quantity: 800, unit: "g" },
      RECHEIO: { quantity: 400, unit: "g" },
    },
  },
};

/* =====================================================
       2. ESTADO ÚNICO (compartilhado pelos dois painéis)
       ===================================================== */
const state = {
  estoque: [],
  proximoIdEstoque: 1,
  nomes: {},
  receitas: {},
  proximoIdProduto: 1,
  historico: [], // lista de movimentações, da mais antiga para a mais nova
  autorizacao: {}, // { idProduto: quantidade } — só em memória, como antes
};

function proximoId(salvo, idsExistentes) {
  const maior = idsExistentes.length ? Math.max(...idsExistentes) : 0;
  return Math.max(parseInt(salvo, 10) || 1, maior + 1);
}

function carregarEstado() {
  state.estoque = store.read(KEYS.estoque, []);
  state.proximoIdEstoque = proximoId(
    store.read(KEYS.proximoIdEstoque, 1),
    state.estoque.map((item) => Number(item.id)),
  );

  const nomes = store.read(KEYS.nomesProdutos, null);
  if (nomes === null) {
    state.nomes = structuredClone(PRODUTOS_PADRAO.nomes);
    state.receitas = structuredClone(PRODUTOS_PADRAO.receitas);
    salvarProdutos();
  } else {
    state.nomes = nomes;
    state.receitas = store.read(KEYS.receitas, {});
  }
  state.proximoIdProduto = proximoId(
    store.read(KEYS.proximoIdProduto, 1),
    Object.keys(state.nomes).map(Number),
  );
  state.historico = store.read(KEYS.historico, []);
}

function salvarEstoque() {
  store.write(KEYS.estoque, state.estoque);
  store.write(KEYS.proximoIdEstoque, state.proximoIdEstoque);
}

function salvarProdutos() {
  store.write(KEYS.nomesProdutos, state.nomes);
  store.write(KEYS.receitas, state.receitas);
  store.write(KEYS.proximoIdProduto, state.proximoIdProduto);
}

// Anota uma movimentação no histórico (usado pelo relatório em PDF)
function registrar(tipo, item, quantidade = null, unidade = "", detalhe = "") {
  state.historico.push({
    data: new Date().toISOString(),
    tipo,
    item,
    quantidade,
    unidade,
    detalhe,
  });
  store.write(KEYS.historico, state.historico);
}

/* =====================================================
       3. UTILITÁRIOS
       ===================================================== */
const $ = (seletor) => document.querySelector(seletor);

// Cria elementos sem innerHTML (evita quebrar a página com nomes que tenham aspas ou <tags>)
function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(attrs)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === "class") el.className = valor;
    else if (chave === "text") el.textContent = valor;
    else if (chave.startsWith("on")) el.addEventListener(chave.slice(2), valor);
    else el.setAttribute(chave, valor === true ? "" : valor);
  }
  el.append(...filhos.flat().filter((f) => f !== null && f !== undefined));
  return el;
}

const normalizar = (nome) =>
  String(nome || "")
    .trim()
    .toUpperCase();

function formatarQtd(qtd, unidade) {
  const fracionada = unidade === "Kg" || unidade === "L";
  return Number(qtd).toLocaleString("pt-BR", {
    minimumFractionDigits: fracionada ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function lerNumero(valor) {
  return parseFloat(String(valor).replace(",", "."));
}

// Converte a quantidade da receita (g, kg, ml, L, un) para a unidade do estoque (Kg, L, Un)
function converterParaEstoque(qtd, unidadeReceita, unidadeEstoque) {
  const r = String(unidadeReceita || "").toLowerCase();
  const s = String(unidadeEstoque || "").toLowerCase();
  const tabela = {
    kg: { g: 0.001, kg: 1 },
    l: { ml: 0.001, l: 1 },
    un: { un: 1 },
  };
  const fator = tabela[s]?.[r] ?? (r === s ? 1 : null);
  return fator === null ? null : qtd * fator;
}

const MAPA_UNIDADE_ESTOQUE = { g: "Kg", kg: "Kg", ml: "L", l: "L", un: "Un" };

let toastTimer;
function avisar(mensagem, tipo = "ok") {
  const toast = $("#toast");
  toast.textContent = mensagem;
  toast.classList.toggle("is-erro", tipo === "erro");
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function atualizarSugestoes() {
  const nomesEstoque = state.estoque.map((item) => item.name);
  const extras = SUGESTOES_PADRAO.map(normalizar).filter(
    (n) => !nomesEstoque.includes(n),
  );
  $("#sugestoesIngredientes").replaceChildren(
    ...[...nomesEstoque, ...extras].map((nome) => h("option", { value: nome })),
  );
}

/* =====================================================
       4. PAINEL ESTOQUE
       ===================================================== */
function renderEstoque() {
  const lista = $("#listaEstoque");
  lista.replaceChildren(...state.estoque.map(linhaEstoque));
  $("#estoqueVazio").hidden = state.estoque.length > 0;
  atualizarSugestoes();
}

function linhaEstoque(item) {
  const entrada = h("input", {
    type: "number",
    class: "field field--destaque",
    min: "0",
    step: item.unit === "Un" ? "1" : "any",
    placeholder: "0",
    "aria-label": `Quantidade a somar em ${item.name}`,
    onkeydown: (e) => {
      if (e.key === "Enter") somarEstoque(item.id, entrada);
    },
  });

  return h(
    "li",
    { class: "stock-row" + (Number(item.quantity) <= 0 ? " is-zerado" : "") },
    h("span", { class: "row-name", text: item.name }),
    h("span", {
      class: "qty-badge",
      text: `${formatarQtd(item.quantity, item.unit)} ${item.unit}`,
    }),
    entrada,
    h("button", {
      type: "button",
      class: "btn-round",
      text: "+",
      "aria-label": `Somar ao estoque de ${item.name}`,
      onclick: () => somarEstoque(item.id, entrada),
    }),
    h("button", {
      type: "button",
      class: "btn-remove",
      text: "×",
      "aria-label": `Excluir ${item.name} do estoque`,
      onclick: () => excluirIngrediente(item.id),
    }),
  );
}

function cadastrarIngrediente(evento) {
  evento.preventDefault();
  const nome = normalizar($("#novoIngredienteNome").value);
  const qtd = lerNumero($("#novoIngredienteQtd").value);
  const unidade = $("#novoIngredienteUnidade").value;

  if (!nome || isNaN(qtd) || qtd < 0) {
    avisar("Preencha o nome e uma quantidade inicial válida.", "erro");
    return;
  }
  if (state.estoque.some((item) => item.name === nome)) {
    avisar(`${nome} já está no estoque. Use o + da linha para somar.`, "erro");
    return;
  }

  state.estoque.push({
    id: state.proximoIdEstoque++,
    name: nome,
    quantity: qtd,
    unit: unidade,
  });
  salvarEstoque();
  registrar(
    "Cadastro de ingrediente",
    nome,
    qtd,
    unidade,
    "Quantidade inicial",
  );
  renderEstoque();

  evento.target.reset();
  evento.target.hidden = true;
  avisar(`${nome} adicionado ao estoque.`);
}

function somarEstoque(id, entrada) {
  const item = state.estoque.find((i) => i.id === id);
  const valor = lerNumero(entrada.value);
  if (!item) return;
  if (isNaN(valor) || valor <= 0) {
    avisar("Informe um valor positivo para somar.", "erro");
    entrada.focus();
    return;
  }
  item.quantity = +(Number(item.quantity) + valor).toFixed(4);
  salvarEstoque();
  registrar(
    "Entrada no estoque",
    item.name,
    valor,
    item.unit,
    `Novo total: ${formatarQtd(item.quantity, item.unit)} ${item.unit}`,
  );
  renderEstoque();
  avisar(
    `${item.name}: novo total ${formatarQtd(item.quantity, item.unit)} ${item.unit}.`,
  );
}

function excluirIngrediente(id) {
  const item = state.estoque.find((i) => i.id === id);
  if (
    !item ||
    !confirm(
      `Excluir ${item.name} do estoque? Esta ação não pode ser desfeita.`,
    )
  )
    return;
  state.estoque = state.estoque.filter((i) => i.id !== id);
  salvarEstoque();
  registrar(
    "Exclusão de ingrediente",
    item.name,
    item.quantity,
    item.unit,
    "Saldo no momento da exclusão",
  );
  renderEstoque();
  avisar(`${item.name} removido do estoque.`);
}

// Garante que todo ingrediente de uma receita exista no estoque (criado com quantidade 0)
function sincronizarIngredientes(receita) {
  let criados = 0;
  for (const [nome, { unit }] of Object.entries(receita)) {
    const nomeEstoque = normalizar(nome);
    if (state.estoque.some((item) => item.name === nomeEstoque)) continue;
    state.estoque.push({
      id: state.proximoIdEstoque++,
      name: nomeEstoque,
      quantity: 0,
      unit: MAPA_UNIDADE_ESTOQUE[String(unit).toLowerCase()] || "Un",
    });
    registrar(
      "Cadastro de ingrediente",
      nomeEstoque,
      0,
      MAPA_UNIDADE_ESTOQUE[String(unit).toLowerCase()] || "Un",
      "Criado a partir de uma receita",
    );
    criados++;
  }
  if (criados > 0) salvarEstoque();
  return criados;
}

/* =====================================================
       5. PAINEL PRODUTOS
       ===================================================== */
function idsProdutosOrdenados() {
  return Object.keys(state.nomes).sort((a, b) => Number(a) - Number(b));
}

function renderProdutos() {
  const ids = idsProdutosOrdenados();
  $("#listaProdutos").replaceChildren(...ids.map(linhaProduto));
  $("#produtosVazio").hidden = ids.length > 0;
}

function linhaProduto(id) {
  const nome = state.nomes[id];
  const receita = state.receitas[id] || {};
  const entrada = h("input", {
    type: "number",
    class: "field",
    min: "0",
    step: "1",
    value: "0",
    "aria-label": `Quantidade de ${nome}`,
    onkeydown: (e) => {
      if (e.key === "Enter") adicionarAutorizacao(id, entrada);
    },
  });

  const itensReceita = Object.entries(receita).map(
    ([ing, { quantity, unit }]) =>
      h("li", { text: `${ing}: ${quantity} ${unit}` }),
  );

  return h(
    "li",
    { class: "product-row" },
    h("span", { class: "row-name", text: nome }),
    entrada,
    h("button", {
      type: "button",
      class: "btn-primary",
      text: "Adicionar",
      onclick: () => adicionarAutorizacao(id, entrada),
    }),
    h(
      "button",
      {
        type: "button",
        class: "btn-edit",
        "aria-label": `Editar produto ${nome}`,
        title: "Editar produto",
        onclick: () => abrirDialogProduto(id),
      },
      h("span", {
        class: "material-symbols-outlined",
        "aria-hidden": "true",
        text: "edit",
      }),
    ),
    h("button", {
      type: "button",
      class: "btn-remove",
      text: "×",
      "aria-label": `Excluir produto ${nome}`,
      onclick: () => excluirProduto(id),
    }),
    itensReceita.length
      ? h(
          "details",
          { class: "recipe" },
          h("summary", { text: "Ver receita por unidade" }),
          h("ul", {}, itensReceita),
        )
      : null,
  );
}

function excluirProduto(id) {
  const nome = state.nomes[id];
  if (!confirm(`Excluir o produto ${nome} do painel?`)) return;
  delete state.nomes[id];
  delete state.receitas[id];
  delete state.autorizacao[id];
  salvarProdutos();
  registrar("Exclusão de produto", nome);
  renderProdutos();
  renderAutorizacao();
  avisar(`${nome} excluído.`);
}

/* ---------- Autorização ---------- */
function adicionarAutorizacao(id, entrada) {
  const qtd = parseInt(entrada.value, 10);
  if (isNaN(qtd) || qtd <= 0) {
    avisar(`Informe uma quantidade válida para ${state.nomes[id]}.`, "erro");
    entrada.focus();
    return;
  }
  state.autorizacao[id] = qtd;
  entrada.value = 0;
  renderAutorizacao();
  avisar(`${qtd}× ${state.nomes[id]} na lista de autorização.`);
}

function renderAutorizacao() {
  const ids = Object.keys(state.autorizacao);
  $("#listaAutorizacao").replaceChildren(
    ...ids.map((id) =>
      h(
        "li",
        {},
        h("span", {
          text: `${state.nomes[id]}: ${state.autorizacao[id]} unidade(s)`,
        }),
        h("button", {
          type: "button",
          class: "btn-remove",
          text: "×",
          "aria-label": `Remover ${state.nomes[id]} da autorização`,
          onclick: () => {
            delete state.autorizacao[id];
            renderAutorizacao();
          },
        }),
      ),
    ),
  );
  $("#autorizacaoVazia").hidden = ids.length > 0;
  $("#btnFinalizar").disabled = ids.length === 0;
}

function finalizarAutorizacao() {
  const ids = Object.keys(state.autorizacao);
  if (ids.length === 0) return;

  // 1. Soma os ingredientes necessários (agrupados por nome + unidade)
  const totais = new Map();
  for (const id of ids) {
    const receita = state.receitas[id] || {};
    for (const [ing, { quantity, unit }] of Object.entries(receita)) {
      const chave = `${normalizar(ing)}|${unit}`;
      const atual = totais.get(chave) || {
        nome: normalizar(ing),
        unidade: unit,
        total: 0,
      };
      atual.total += quantity * state.autorizacao[id];
      totais.set(chave, atual);
    }
  }

  // 2. Anota no histórico cada produto autorizado
  const descricao = ids
    .map((id) => `${state.autorizacao[id]}x ${state.nomes[id]}`)
    .join(", ");
  for (const id of ids) {
    registrar(
      "Produção autorizada",
      state.nomes[id],
      state.autorizacao[id],
      "un",
    );
  }

  // 3. Debita do estoque, sem deixar negativo
  const avisos = [];
  for (const { nome, unidade, total } of totais.values()) {
    const item = state.estoque.find((i) => i.name === nome);
    if (!item) {
      avisos.push(`${nome} não está no estoque.`);
      continue;
    }
    const debito = converterParaEstoque(total, unidade, item.unit);
    if (debito === null) {
      avisos.push(
        `Não foi possível converter ${nome} de ${unidade} para ${item.unit}.`,
      );
      continue;
    }
    if (item.quantity >= debito) {
      item.quantity = +(item.quantity - debito).toFixed(4);
      registrar(
        "Saída do estoque",
        nome,
        debito,
        item.unit,
        `Autorização: ${descricao}`,
      );
    } else {
      const falta = debito - item.quantity;
      avisos.push(
        `Estoque insuficiente de ${nome}: faltam ${formatarQtd(falta, item.unit)} ${item.unit}.`,
      );
      registrar(
        "Saída do estoque",
        nome,
        item.quantity,
        item.unit,
        `Autorização: ${descricao}. Faltaram ${formatarQtd(falta, item.unit)} ${item.unit}`,
      );
      item.quantity = 0;
    }
  }
  salvarEstoque();

  // 4. Mostra o resumo
  $("#resumoTexto").textContent =
    `${ids.length} produto(s) autorizado(s). Ingredientes usados:`;
  $("#resumoIngredientes").replaceChildren(
    ...[...totais.values()].map((t) =>
      h("li", {
        text: `${t.nome}: ${Number(t.total.toFixed(2)).toLocaleString("pt-BR")} ${t.unidade}`,
      }),
    ),
  );
  $("#resumoAvisosLista").replaceChildren(
    ...avisos.map((a) => h("li", { text: a })),
  );
  $("#resumoAvisos").hidden = avisos.length === 0;
  $("#dialogResumo").showModal();

  state.autorizacao = {};
  renderAutorizacao();
  renderEstoque();
}

/* ---------- Diálogo de novo produto ---------- */
const NOVO_INGREDIENTE = "__novo__";

// Unidade sugerida na receita conforme a unidade do estoque (Kg → g, L → ml, Un → un)
const UNIDADE_RECEITA_PADRAO = { Kg: "g", L: "ml", Un: "un" };

// "inicial" é opcional: { nome, quantity, unit } para preencher a linha ao editar
function linhaReceita(inicial = null) {
  const temEstoque = state.estoque.length > 0;
  const noEstoque =
    inicial && state.estoque.some((i) => i.name === normalizar(inicial.nome));

  // Campo de texto: só aparece quando a pessoa escolhe "+ Novo ingrediente"
  const campoNovo = h("input", {
    type: "text",
    class: "field ing-name",
    list: "sugestoesIngredientes",
    placeholder: "Nome do novo ingrediente",
    "aria-label": "Nome do novo ingrediente",
    hidden: temEstoque && (!inicial || noEstoque),
    value: inicial && !noEstoque ? inicial.nome : null,
  });

  const unidade = h(
    "select",
    { class: "field ing-unit", "aria-label": "Unidade" },
    ["g", "kg", "ml", "L", "un"].map((u) => h("option", { value: u, text: u })),
  );

  // Lista com os ingredientes que já estão no estoque
  const escolha = h(
    "select",
    {
      class: "field ing-choice",
      "aria-label": "Ingrediente",
      onchange: () => {
        const novo = escolha.value === NOVO_INGREDIENTE;
        campoNovo.hidden = !novo;
        if (novo) {
          campoNovo.focus();
          return;
        }
        const item = state.estoque.find((i) => i.name === escolha.value);
        if (item) unidade.value = UNIDADE_RECEITA_PADRAO[item.unit] || "un";
      },
    },
    h("option", {
      value: "",
      text: temEstoque ? "Escolha um ingrediente…" : "Estoque vazio",
    }),
    state.estoque.map((item) =>
      h("option", {
        value: item.name,
        text: `${item.name} (${formatarQtd(item.quantity, item.unit)} ${item.unit})`,
      }),
    ),
    h("option", { value: NOVO_INGREDIENTE, text: "+ Novo ingrediente" }),
  );
  if (!temEstoque) escolha.value = NOVO_INGREDIENTE;

  // Ao editar: ingrediente do estoque fica selecionado; se não estiver no estoque, vai no campo de texto
  if (inicial) {
    escolha.value = noEstoque ? normalizar(inicial.nome) : NOVO_INGREDIENTE;
    unidade.value = inicial.unit;
  }

  const linha = h(
    "div",
    { class: "recipe-row" },
    escolha,
    h("input", {
      type: "number",
      class: "field ing-qty",
      step: "any",
      min: "0",
      value: inicial ? String(inicial.quantity) : "1",
      "aria-label": "Quantia por unidade",
    }),
    unidade,
    h("button", {
      type: "button",
      class: "btn-remove",
      text: "×",
      "aria-label": "Remover ingrediente",
      onclick: () => linha.remove(),
    }),
    campoNovo,
  );
  return linha;
}

let produtoEmEdicao = null; // id do produto sendo editado, ou null quando é um cadastro novo

function abrirDialogProduto(id = null) {
  produtoEmEdicao = id;
  $("#formProduto").reset();
  $("#dialogProdutoTitulo").textContent = id
    ? "Editar produto"
    : "Cadastrar novo produto";
  $("#btnSalvarProduto").textContent = id
    ? "Salvar alterações"
    : "Salvar produto";

  if (id) {
    $("#novoProdutoNome").value = state.nomes[id];
    const itens = Object.entries(state.receitas[id] || {});
    $("#linhasReceita").replaceChildren(
      ...(itens.length
        ? itens.map(([nome, r]) =>
            linhaReceita({ nome, quantity: r.quantity, unit: r.unit }),
          )
        : [linhaReceita()]),
    );
  } else {
    $("#linhasReceita").replaceChildren(linhaReceita());
  }
  atualizarSugestoes();
  $("#dialogProduto").showModal();
  $("#novoProdutoNome").focus();
}

function salvarProduto(evento) {
  evento.preventDefault();
  const nome = normalizar($("#novoProdutoNome").value);

  if (!nome) {
    avisar("O nome do produto não pode ficar vazio.", "erro");
    return;
  }
  const nomeRepetido = Object.entries(state.nomes).some(
    ([outroId, outroNome]) => outroNome === nome && outroId !== produtoEmEdicao,
  );
  if (nomeRepetido) {
    avisar("Já existe um produto com esse nome.", "erro");
    return;
  }

  const receita = {};
  for (const linha of $("#linhasReceita").children) {
    const escolhido = linha.querySelector(".ing-choice").value;
    const ing = normalizar(
      escolhido === NOVO_INGREDIENTE
        ? linha.querySelector(".ing-name").value
        : escolhido,
    );
    const qtd = lerNumero(linha.querySelector(".ing-qty").value);
    if (!ing || isNaN(qtd) || qtd <= 0) continue;
    if (receita[ing]) {
      avisar(`${ing} aparece duas vezes na receita.`, "erro");
      return;
    }
    receita[ing] = {
      quantity: qtd,
      unit: linha.querySelector(".ing-unit").value,
    };
  }

  if (Object.keys(receita).length === 0) {
    avisar(
      "Cadastre pelo menos um ingrediente com quantia maior que zero.",
      "erro",
    );
    return;
  }

  const editando = produtoEmEdicao !== null;
  const id = editando ? produtoEmEdicao : String(state.proximoIdProduto++);
  const nomeAnterior = state.nomes[id];
  state.nomes[id] = nome;
  state.receitas[id] = receita;
  salvarProdutos();

  const textoReceita =
    "Receita: " +
    Object.entries(receita)
      .map(([ing, r]) => `${ing} ${r.quantity} ${r.unit}`)
      .join(", ");
  if (editando) {
    const renomeado = nomeAnterior !== nome ? ` (antes: ${nomeAnterior})` : "";
    registrar("Edição de produto", nome, null, "", textoReceita + renomeado);
  } else {
    registrar("Cadastro de produto", nome, null, "", textoReceita);
  }
  const criados = sincronizarIngredientes(receita);

  $("#dialogProduto").close();
  produtoEmEdicao = null;
  renderProdutos();
  renderAutorizacao(); // se o nome mudou, a lista de autorização mostra o nome novo
  renderEstoque();

  const acao = editando ? "atualizado" : "cadastrado";
  avisar(
    criados
      ? `${nome} ${acao}. ${criados} ingrediente(s) novo(s) criado(s) no estoque.`
      : `${nome} ${acao}.`,
  );
}

/* =====================================================
       6. RELATÓRIO EM PDF
       ===================================================== */
function gerarRelatorioPDF() {
  if (!window.jspdf) {
    avisar(
      "O gerador de PDF não carregou. Verifique a internet e recarregue a página.",
      "erro",
    );
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const agora = new Date();
  const corMarca = [237, 143, 54];

  // Cabeçalho
  doc.setFontSize(16);
  doc.text("Relatório de movimentação - Luana Salgadinhos", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Gerado em ${agora.toLocaleString("pt-BR")}`, 14, 25);
  doc.setTextColor(0);

  // Parte 1: como o estoque está agora
  doc.setFontSize(13);
  doc.text("Estoque atual", 14, 36);
  doc.autoTable({
    startY: 40,
    head: [["Ingrediente", "Quantidade", "Unidade"]],
    body: state.estoque.length
      ? state.estoque.map((i) => [
          i.name,
          formatarQtd(i.quantity, i.unit),
          i.unit,
        ])
      : [[{ content: "Nenhum ingrediente no estoque.", colSpan: 3 }]],
    headStyles: { fillColor: corMarca },
    columnStyles: { 1: { halign: "right" } },
  });

  // Parte 2: todas as movimentações, da mais nova para a mais antiga
  let y = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(13);
  doc.text("Movimentações", 14, y);
  doc.autoTable({
    startY: y + 4,
    head: [["Data", "Tipo", "Item", "Quantidade", "Detalhe"]],
    body: state.historico.length
      ? [...state.historico]
          .reverse()
          .map((m) => [
            new Date(m.data).toLocaleString("pt-BR"),
            m.tipo,
            m.item,
            m.quantidade === null
              ? ""
              : `${formatarQtd(m.quantidade, m.unidade)} ${m.unidade}`,
            m.detalhe,
          ])
      : [[{ content: "Nenhuma movimentação registrada ainda.", colSpan: 5 }]],
    headStyles: { fillColor: corMarca },
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 30 }, 3: { halign: "right" } },
  });

  // Número da página no rodapé
  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`Página ${i} de ${totalPaginas}`, 196, 290, { align: "right" });
  }

  const dataArquivo = agora
    .toLocaleDateString("pt-BR")
    .split("/")
    .reverse()
    .join("-"); // ex.: 2026-09-22
  doc.save(`relatorio-movimentacao-${dataArquivo}.pdf`);
  avisar("Relatório baixado.");
}

/* =====================================================
       7. NAVEGAÇÃO ENTRE PAINÉIS (#estoque / #produtos)
       ===================================================== */
const PAINEIS = {
  estoque: {
    titulo: "ESTOQUE",
    iconeTrocar: "storefront",
    rotuloTrocar: "Ir para produtos",
    rotuloNovo: "Novo ingrediente",
  },
  produtos: {
    titulo: "PRODUTOS",
    iconeTrocar: "warehouse",
    rotuloTrocar: "Ir para o estoque",
    rotuloNovo: "Novo produto",
  },
};

let painelAtual = "produtos";

function mostrarPainel(nome) {
  painelAtual = PAINEIS[nome] ? nome : "produtos";
  const cfg = PAINEIS[painelAtual];

  $("#painel-estoque").hidden = painelAtual !== "estoque";
  $("#painel-produtos").hidden = painelAtual !== "produtos";
  $("#tituloPainel").textContent = cfg.titulo;
  $("#iconeTrocar").textContent = cfg.iconeTrocar;

  const btnTrocar = $("#btnTrocarPainel");
  btnTrocar.setAttribute("aria-label", cfg.rotuloTrocar);
  btnTrocar.title = cfg.rotuloTrocar;

  const btnNovo = $("#btnNovo");
  btnNovo.setAttribute("aria-label", cfg.rotuloNovo);
  btnNovo.title = cfg.rotuloNovo;

  document.title = `${cfg.titulo === "ESTOQUE" ? "Estoque" : "Produtos"} · Luana Salgadinhos`;
}

function painelDaUrl() {
  return location.hash.replace("#", "") || "produtos";
}

/* =====================================================
       8. EVENTOS E INICIALIZAÇÃO
       ===================================================== */
$("#btnTrocarPainel").addEventListener("click", () => {
  location.hash = painelAtual === "estoque" ? "produtos" : "estoque";
});

$("#btnNovo").addEventListener("click", () => {
  if (painelAtual === "produtos") {
    abrirDialogProduto();
    return;
  }
  const form = $("#formIngrediente");
  form.hidden = !form.hidden;
  if (!form.hidden) $("#novoIngredienteNome").focus();
});

window.addEventListener("hashchange", () => mostrarPainel(painelDaUrl()));

$("#formIngrediente").addEventListener("submit", cadastrarIngrediente);
$("#formProduto").addEventListener("submit", salvarProduto);
$("#btnAddIngrediente").addEventListener("click", () => {
  const linha = linhaReceita();
  $("#linhasReceita").append(linha);
  linha.querySelector(".ing-choice").focus();
});
$("#btnCancelarProduto").addEventListener("click", () =>
  $("#dialogProduto").close(),
);
$("#btnFinalizar").addEventListener("click", finalizarAutorizacao);
$("#btnFecharResumo").addEventListener("click", () =>
  $("#dialogResumo").close(),
);
$("#btnRelatorio").addEventListener("click", gerarRelatorioPDF);

// Se o estoque mudar em outra aba (ex.: painel.html aberto junto), recarrega os dados
window.addEventListener("storage", (e) => {
  if (!Object.values(KEYS).includes(e.key)) return;
  carregarEstado();
  renderEstoque();
  renderProdutos();
  renderAutorizacao();
});

carregarEstado();
renderEstoque();
renderProdutos();
renderAutorizacao();
mostrarPainel(painelDaUrl());
