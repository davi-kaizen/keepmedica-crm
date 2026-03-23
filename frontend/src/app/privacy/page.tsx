import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politica de Privacidade | KeepMedica",
  description: "Politica de Privacidade do KeepMedica CRM",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0A] overflow-auto">
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Politica de Privacidade
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-10">
          Ultima atualizacao: 22 de marco de 2026
        </p>

        <section className="space-y-8 text-slate-700 dark:text-slate-300 leading-relaxed">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              1. Sobre o KeepMedica
            </h2>
            <p>
              O <strong>KeepMedica</strong> e um sistema de CRM (Customer Relationship Management)
              desenvolvido para clinicas medicas. Nossa plataforma permite a gestao de leads,
              agendamentos, comunicacao com pacientes e integracao com mensagens do Instagram,
              centralizando o atendimento em um unico lugar.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              2. Dados Coletados
            </h2>
            <p className="mb-3">
              Para fornecer nossos servicos, coletamos os seguintes dados por meio da integracao
              com a API do Meta/Instagram:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Nome de usuario do Instagram</li>
              <li>Informacoes do perfil publico (nome, foto de perfil)</li>
              <li>Conversas de mensagens diretas (DMs) do Instagram</li>
              <li>Dados de cadastro fornecidos pelo usuario na plataforma (nome, e-mail, telefone)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              3. Como Utilizamos os Dados
            </h2>
            <p>Os dados coletados sao utilizados exclusivamente para:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-3">
              <li>Gerenciar leads e oportunidades de negocio da clinica</li>
              <li>Facilitar a comunicacao entre a clinica e seus pacientes via Instagram</li>
              <li>Organizar o pipeline de atendimento e agendamentos</li>
              <li>Gerar relatorios internos de desempenho da clinica</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              4. Armazenamento e Seguranca
            </h2>
            <p>
              Seus dados sao armazenados em servidores seguros com acesso restrito. Adotamos
              medidas tecnicas e organizacionais para proteger as informacoes contra acesso nao
              autorizado, perda ou alteracao. As senhas dos usuarios sao armazenadas de forma
              criptografada e nunca sao acessiveis em texto puro.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              5. Integracao com Terceiros
            </h2>
            <p>
              O KeepMedica utiliza a <strong>API do Meta (Instagram)</strong> para acessar
              mensagens diretas e informacoes de perfil. Essa integracao segue as diretrizes
              e politicas da plataforma Meta. Nao compartilhamos seus dados com terceiros
              alem do necessario para o funcionamento da integracao com o Instagram.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              6. Exclusao de Dados
            </h2>
            <p>
              Voce pode solicitar a exclusao dos seus dados a qualquer momento entrando em
              contato com nossa equipe de suporte. Apos a solicitacao, seus dados serao
              removidos de nossos sistemas em ate 30 dias uteis.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              7. Seus Direitos
            </h2>
            <p>De acordo com a Lei Geral de Protecao de Dados (LGPD), voce tem direito a:</p>
            <ul className="list-disc list-inside space-y-1 pl-2 mt-3">
              <li>Acessar seus dados pessoais</li>
              <li>Corrigir dados incompletos ou desatualizados</li>
              <li>Solicitar a exclusao dos seus dados</li>
              <li>Revogar o consentimento para o uso dos dados</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
              8. Contato
            </h2>
            <p>
              Para duvidas, solicitacoes ou exercicio dos seus direitos, entre em contato conosco:
            </p>
            <p className="mt-3 font-medium">
              <a
                href="mailto:contato@keepmedica.com.br"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                contato@keepmedica.com.br
              </a>
            </p>
          </div>
        </section>

        <div className="mt-16 pt-8 border-t border-slate-200 dark:border-slate-800 text-center text-sm text-slate-400 dark:text-slate-500">
          &copy; {new Date().getFullYear()} KeepMedica. Todos os direitos reservados.
        </div>
      </main>
    </div>
  );
}
