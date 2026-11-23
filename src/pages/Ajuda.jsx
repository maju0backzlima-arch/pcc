import { useState } from "react";

const PERFIS = [
  { id: "caixa", label: "Barista/Caixa" },
  { id: "gerente", label: "Gerente/Dono" }
];

const CONTEUDO = {
  caixa: [
    {
      title: "Abertura de caixa",
      steps: [
        "Entre com seu e-mail e senha.",
        "Abra Financeiro → Conferência e confira o fundo de caixa do dia.",
        "Se faltar dinheiro, lance um suprimento em Caixa → Suprimento.",
        "Confira se o PDV+ está sincronizado na Central da equipe."
      ]
    },
    {
      title: "Fechamento de caixa",
      steps: [
        "Some Pix, crédito, débito, voucher e dinheiro do PDV+.",
        "Em Conferência, informe o valor da gaveta e da maquininha por método.",
        "Grave a conferência. Diferença aparece em vermelho.",
        "Faça a sangria do dinheiro físico (Caixa → Sangria).",
        "Anote qualquer divergência em lançamento manual."
      ]
    },
    {
      title: "Lançamento de perdas",
      steps: [
        "Abra Estoque → Perdas.",
        "Escolha o insumo, a quantidade e o motivo (leite vencido, regulagem de moedor).",
        "Confirme. O custo entra na DRE do gerente e a lista de compras se atualiza."
      ]
    },
    {
      title: "Lista de compras",
      steps: [
        "Estoque → Lista de compras.",
        "Só entra o que está no mínimo ou abaixo.",
        "Quantidade sugerida = estoque ideal − estoque atual.",
        "Itens já vêm agrupados por fornecedor.",
        "Copie para o WhatsApp e envie ao comprador."
      ]
    },
    {
      title: "Emissão de NFC-e",
      steps: [
        "Abra Notas.",
        "Selecione a venda do PDV+ e, se o cliente pedir, informe o CPF.",
        "Emitir envia NCM, CFOP e CSOSN 102 (preparo) ou 500 (revenda).",
        "Baixe DANFE ou XML na tabela.",
        "Cancelamento fiscal é só do gerente/dono."
      ]
    }
  ],
  gerente: [
    {
      title: "Cancelamento de NFC-e",
      steps: [
        "Notas → informe justificativa com no mínimo 15 caracteres.",
        "Cancelar a nota autorizada.",
        "O sistema estorna a entrada no fluxo de caixa e devolve insumos/produtos ao estoque.",
        "A venda fica marcada como estornada e some da DRE."
      ]
    },
    {
      title: "Exportação para o contador",
      steps: [
        "Notas → escolha o mês.",
        "Clique em Exportar XMLs do mês (.zip).",
        "Envie o arquivo ao contador (autorizadas, canceladas e inutilizadas).",
        "Faixas puladas: Inutilizar numeração com justificativa."
      ]
    },
    {
      title: "DRE e CMV",
      steps: [
        "Financeiro → DRE: bruto, DAS, taxas, CMV, lucro bruto, fixas, líquido.",
        "Ficha técnica com CMV acima de 32% fica destacada em Estoque e no cardápio.",
        "Categorias de despesa: Fornecedores, Aluguel, Energia, Folha, Imposto DAS.",
        "Pix/débito/voucher D+1 · crédito D+30."
      ]
    },
    {
      title: "Permissões",
      steps: [
        "Barista/Caixa não vê DRE, não edita ficha técnica e não cancela NFC-e.",
        "Estoquista edita ficha e insumos.",
        "Financeiro e Gerente/Dono veem DRE e cancelam nota.",
        "Só o Gerente/Dono gerencia colaboradores em Equipe."
      ]
    }
  ]
};

export default function Ajuda() {
  const [perfil, setPerfil] = useState("caixa");
  const [open, setOpen] = useState("0");

  return (
    <main className="page">
      <div className="section-head">
        <div>
          <p className="kicker">Manual da casa</p>
          <h2>Como a equipe opera</h2>
        </div>
        <p>Checklists por perfil: abertura, perdas, compras, NFC-e e exportação ao contador.</p>
      </div>
      <div className="cats">
        {PERFIS.map((p) => (
          <button key={p.id} className={`tab ${perfil === p.id ? "active" : ""}`} onClick={() => { setPerfil(p.id); setOpen("0"); }}>
            {p.label}
          </button>
        ))}
      </div>
      {(CONTEUDO[perfil] || []).map((bloco, i) => (
        <details key={bloco.title} className="guide" open={open === String(i)} onToggle={(e) => e.target.open && setOpen(String(i))}>
          <summary>{bloco.title}</summary>
          <ol className="howto">
            {bloco.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </details>
      ))}
    </main>
  );
}
