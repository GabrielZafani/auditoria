import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// [1] TIPAGEM
type ItemEstoque = {
  id: number;
  nome: string;
  preco: number;
  quantidade: number;
};

type RelatorioAuditoria = {
  valorTotalEstoque: number;
  produtosCriticos: ItemEstoque[];
};

// Caminhos resolvidos a partir do próprio módulo, e não do diretório de onde o
// comando foi disparado: "./estoque.json" puro quebra a auditoria quando o
// script é chamado de outra pasta (`node auditoria-estoque/auditoria.ts`).
const ARQUIVO_ESTOQUE = new URL("./estoque.json", import.meta.url);
const ARQUIVO_AUDITORIA = new URL("./auditoria.json", import.meta.url);

// Caminho legível para as mensagens: `URL.pathname` sai codificado em
// percentual ("/C:/...%C3%81rea%20de%20Trabalho/") e ninguém acha a pasta.
const CAMINHO_ESTOQUE = fileURLToPath(ARQUIVO_ESTOQUE);
const CAMINHO_AUDITORIA = fileURLToPath(ARQUIVO_AUDITORIA);

const NIVEL_CRITICO = 5;

// JSON.parse devolve `any`: sem esta porta de entrada, um arquivo com "preco"
// em texto ("349,90") entraria calado e o valor total viraria NaN no relatório.
function validarEstoque(dados: unknown): ItemEstoque[] {
  if (!Array.isArray(dados)) {
    throw new Error("estoque.json precisa conter uma lista de itens.");
  }

  return dados.map((item, indice) => {
    const candidato = item as Partial<ItemEstoque>;

    if (
      typeof candidato?.id !== "number" ||
      typeof candidato?.nome !== "string" ||
      typeof candidato?.preco !== "number" ||
      typeof candidato?.quantidade !== "number"
    ) {
      throw new Error(
        `Item na posição ${indice} está fora do formato esperado ` +
          "(id: number, nome: string, preco: number, quantidade: number).",
      );
    }

    return {
      id: candidato.id,
      nome: candidato.nome,
      preco: candidato.preco,
      quantidade: candidato.quantidade,
    };
  });
}

// [3] LÓGICA
function gerarRelatorio(itens: ItemEstoque[]): RelatorioAuditoria {
  const total = itens.reduce(
    (acumulado, item) => acumulado + item.preco * item.quantidade,
    0,
  );

  return {
    // Soma de ponto flutuante acumula resíduo (0.1 + 0.2 = 0.30000000000000004);
    // o relatório é dinheiro e não pode sair com 12 casas decimais.
    valorTotalEstoque: Math.round(total * 100) / 100,
    produtosCriticos: itens.filter((item) => item.quantidade < NIVEL_CRITICO),
  };
}

function descreverFalha(erro: unknown): string {
  if (erro instanceof Error && "code" in erro && erro.code === "ENOENT") {
    return `Arquivo de estoque não encontrado em ${CAMINHO_ESTOQUE}`;
  }
  if (erro instanceof SyntaxError) {
    return `estoque.json não é um JSON válido: ${erro.message}`;
  }
  return erro instanceof Error ? erro.message : String(erro);
}

// [2] PIPELINE + [4] PERSISTÊNCIA
// Tudo em fs/promises encadeado: nenhuma variante *Sync entra aqui, para a
// Main Thread seguir livre enquanto o disco responde.
readFile(ARQUIVO_ESTOQUE, "utf-8")
  .then((conteudo) => validarEstoque(JSON.parse(conteudo)))
  .then((itens) => gerarRelatorio(itens))
  .then((relatorio) =>
    writeFile(ARQUIVO_AUDITORIA, JSON.stringify(relatorio, null, 2), "utf-8")
      // Repassa o relatório adiante: `writeFile` resolve com undefined e o
      // resumo final ficaria sem dado nenhum para imprimir.
      .then(() => relatorio),
  )
  .then((relatorio) => {
    console.log("Auditoria concluída:", CAMINHO_AUDITORIA);
    console.log(
      "Valor total do estoque: R$",
      relatorio.valorTotalEstoque.toFixed(2),
    );
    console.log("Produtos em nível crítico:", relatorio.produtosCriticos.length);
  })
  .catch((erro: unknown) => {
    console.error("Falha na auditoria:", descreverFalha(erro));
    // exitCode em vez de process.exit(1): encerrar na hora corta a escrita
    // pendente do stderr e a mensagem de erro some do terminal.
    process.exitCode = 1;
  });
