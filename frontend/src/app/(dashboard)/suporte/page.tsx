'use client';

import { useState } from 'react';

const SECTIONS = [
    {
        title: '1. Visão Geral do Sistema',
        icon: 'fas fa-compass',
        description: 'Aprenda os fundamentos do KeepMedica e como navegar pela plataforma.',
        videos: [
            { title: 'Primeiro acesso e configuração inicial', duration: '5:30' },
            { title: 'Navegação e atalhos do painel', duration: '3:45' },
            { title: 'Perfil e preferências do usuário', duration: '4:20' },
        ],
    },
    {
        title: '2. Gestão de Leads',
        icon: 'fas fa-funnel-dollar',
        description: 'Domine o pipeline de vendas e acompanhe cada oportunidade.',
        videos: [
            { title: 'Cadastrando e organizando leads', duration: '6:15' },
            { title: 'Movendo leads entre etapas do funil', duration: '4:50' },
            { title: 'Editando e removendo leads', duration: '3:30' },
        ],
    },
    {
        title: '3. Central de Chat',
        icon: 'fas fa-comments',
        description: 'Comunicação direta com pacientes via Instagram e WhatsApp.',
        videos: [
            { title: 'Iniciando conversas com pacientes', duration: '5:00' },
            { title: 'Usando respostas rápidas', duration: '3:15' },
        ],
    },
    {
        title: '4. Agenda e Consultas',
        icon: 'fas fa-calendar-check',
        description: 'Gerencie agendamentos, profissionais e procedimentos.',
        videos: [
            { title: 'Agendando uma nova consulta', duration: '4:40' },
            { title: 'Gerenciando profissionais', duration: '3:55' },
            { title: 'Visão semanal e filtros avançados', duration: '4:10' },
        ],
    },
    {
        title: '5. Financeiro e Orçamentos',
        icon: 'fas fa-wallet',
        description: 'Controle orçamentos, aprovações e fluxo financeiro da clínica.',
        videos: [
            { title: 'Criando e aprovando orçamentos', duration: '5:25' },
            { title: 'Acompanhando o fluxo financeiro', duration: '4:30' },
        ],
    },
    {
        title: '6. Relatórios e Métricas',
        icon: 'fas fa-chart-line',
        description: 'Acompanhe a performance da clínica com dados em tempo real.',
        videos: [
            { title: 'Interpretando o dashboard analítico', duration: '6:00' },
            { title: 'Funil de vendas e taxa de conversão', duration: '4:45' },
        ],
    },
];

export default function SuportePage() {
    const [search, setSearch] = useState('');

    const filteredSections = search.trim()
        ? SECTIONS.map(s => ({
            ...s,
            videos: s.videos.filter(v =>
                v.title.toLowerCase().includes(search.toLowerCase()) ||
                s.title.toLowerCase().includes(search.toLowerCase())
            ),
        })).filter(s => s.videos.length > 0)
        : SECTIONS;

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-[#0A0A0A] overflow-y-auto">
            {/* Header */}
            <div className="shrink-0 sticky top-0 z-10 bg-slate-50/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800/60">
                <div className="max-w-[1360px] mx-auto w-full px-6 md:px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
                            <i className="fas fa-graduation-cap text-brand text-lg"></i>
                            Academia KeepMedica
                        </h1>
                        <p className="text-[13px] text-slate-500 mt-0.5">Tutoriais e guias para dominar cada recurso do sistema.</p>
                    </div>
                    <div className="relative">
                        <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600 text-xs"></i>
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar tutorial..."
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand/50 focus:border-brand/30 placeholder-slate-400 dark:placeholder-slate-600 w-64 transition"
                        />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 max-w-[1360px] mx-auto w-full px-6 md:px-8 py-6 space-y-10">
                {filteredSections.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50 flex items-center justify-center mb-4">
                            <i className="fas fa-search text-xl text-slate-400 dark:text-slate-600"></i>
                        </div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Nenhum tutorial encontrado</p>
                        <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">Tente buscar com outras palavras-chave.</p>
                    </div>
                )}

                {filteredSections.map((section, sIdx) => (
                    <div key={sIdx}>
                        {/* Section header */}
                        <div className="flex items-start gap-3 mb-5">
                            <div className="w-9 h-9 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0 mt-0.5">
                                <i className={`${section.icon} text-brand text-sm`}></i>
                            </div>
                            <div>
                                <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">{section.title}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>
                            </div>
                        </div>

                        {/* Video grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {section.videos.map((video, vIdx) => (
                                <div key={vIdx} className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden group hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                                    {/* Video Placeholder */}
                                    <div className="aspect-video bg-slate-100 dark:bg-slate-900 flex items-center justify-center relative">
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 dark:from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <div className="w-12 h-12 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center group-hover:bg-brand group-hover:border-brand/50 group-hover:scale-110 transition-all shadow-lg">
                                            <i className="fas fa-play text-slate-500 dark:text-white group-hover:text-white text-sm ml-0.5"></i>
                                        </div>
                                        <span className="absolute bottom-2 right-2 bg-black/60 dark:bg-black/70 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md backdrop-blur-sm">
                                            {video.duration}
                                        </span>
                                    </div>
                                    {/* Info */}
                                    <div className="p-4">
                                        <h4 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition leading-snug">{video.title}</h4>
                                        <div className="flex items-center gap-3 mt-2">
                                            <span className="text-[11px] text-slate-400 dark:text-slate-600 flex items-center gap-1">
                                                <i className="far fa-clock text-[9px]"></i> {video.duration}
                                            </span>
                                            <span className="text-[11px] text-slate-300 dark:text-slate-700 flex items-center gap-1">
                                                <i className="fas fa-play-circle text-[9px]"></i> Tutorial
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Help footer */}
                <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 flex flex-col sm:flex-row items-center gap-6">
                    <div className="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                        <i className="fas fa-headset text-brand text-xl"></i>
                    </div>
                    <div className="flex-1 text-center sm:text-left">
                        <h4 className="text-[15px] font-bold text-slate-900 dark:text-white mb-1">Precisa de ajuda adicional?</h4>
                        <p className="text-sm text-slate-500">Entre em contato com nossa equipe para resolver qualquer dúvida.</p>
                    </div>
                    <button className="bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-black font-semibold px-6 py-2.5 rounded-xl transition cursor-pointer text-sm shadow-sm shrink-0">
                        <i className="fas fa-envelope mr-2 text-xs"></i> Falar com Suporte
                    </button>
                </div>
            </div>
        </div>
    );
}
