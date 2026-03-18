'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

type ModuleCardProps = {
    title: string;
    description: string;
    icon: string;
    borderColor: string;
    accentColor: string;
    hoverShadow: string;
    path: string;
    onClick: () => void;
};

function ModuleCard({ title, description, icon, borderColor, accentColor, hoverShadow, onClick }: ModuleCardProps) {
    return (
        <div
            onClick={onClick}
            className={`
                group relative bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-transparent border-t-4 ${borderColor}
                cursor-pointer transition-all duration-300
                hover:-translate-y-1 ${hoverShadow}
                flex flex-col justify-between min-h-[16rem] p-6 overflow-hidden
            `}
        >
            <div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4 ${accentColor}`}>
                    <i className={`${icon} ${accentColor}`}></i>
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{description}</p>
            </div>
            <span className={`text-sm font-bold mt-4 inline-flex items-center gap-1 ${accentColor} group-hover:gap-2 transition-all duration-300`}>
                Acessar <i className="fas fa-chevron-right text-xs"></i>
            </span>
        </div>
    );
}

// roles: quais roles podem ver cada módulo
const MODULES = [
    {
        title: 'Leads',
        description: 'Gerencie seus pacientes via pipeline visual. Arraste e solte entre etapas do funil.',
        icon: 'fas fa-comments',
        borderColor: 'border-orange-500',
        accentColor: 'text-orange-500',
        hoverShadow: 'hover:shadow-xl hover:shadow-orange-500/10',
        path: '/leads',
        roles: ['admin', 'tier1', 'tier2'],
    },
    {
        title: 'Chat',
        description: 'Centralize WhatsApp e Instagram. Responda seus pacientes em tempo real.',
        icon: 'fab fa-whatsapp',
        borderColor: 'border-green-500',
        accentColor: 'text-green-500',
        hoverShadow: 'hover:shadow-xl hover:shadow-green-500/10',
        path: '/chat',
        roles: ['admin', 'tier1'],
    },
    {
        title: 'Agenda',
        description: 'Controle de consultas e horários. Visualize a semana inteira do corpo clínico.',
        icon: 'far fa-calendar-alt',
        borderColor: 'border-blue-400',
        accentColor: 'text-blue-400',
        hoverShadow: 'hover:shadow-xl hover:shadow-blue-400/10',
        path: '/agenda',
        roles: ['admin', 'tier1'],
    },
    {
        title: 'Relatórios',
        description: 'Métricas e BI da clínica. Funil de vendas, origem de leads e ROI.',
        icon: 'fas fa-chart-pie',
        borderColor: 'border-lime-500',
        accentColor: 'text-lime-500',
        hoverShadow: 'hover:shadow-xl hover:shadow-lime-500/10',
        path: '/relatorios',
        roles: ['admin', 'tier1', 'tier2'],
    },
    {
        title: 'Financeiro',
        description: 'Gestão de orçamentos, aprovações e previsão de recebíveis.',
        icon: 'fas fa-wallet',
        borderColor: 'border-purple-500',
        accentColor: 'text-purple-500',
        hoverShadow: 'hover:shadow-xl hover:shadow-purple-500/10',
        path: '/financeiro',
        roles: ['admin', 'tier1'],
    },
    {
        title: 'Usuários',
        description: 'Gerencie acessos, permissões e perfis dos operadores do sistema.',
        icon: 'fas fa-users-cog',
        borderColor: 'border-blue-600',
        accentColor: 'text-blue-600',
        hoverShadow: 'hover:shadow-xl hover:shadow-blue-600/10',
        path: '/usuarios',
        roles: ['admin'],
    },
    {
        title: 'Suporte & Tutoriais',
        description: 'Acesse a central de ajuda, documentação e tutoriais em vídeo.',
        icon: 'fas fa-life-ring',
        borderColor: 'border-slate-400 dark:border-slate-600',
        accentColor: 'text-blue-400',
        hoverShadow: 'hover:shadow-xl hover:shadow-slate-500/10',
        path: '/suporte',
        roles: ['admin', 'tier1', 'tier2'],
    },
];

export default function HubPage() {
    const router = useRouter();
    const { user } = useAuth();
    const userRole = user?.role || 'tier2';

    const visibleModules = MODULES.filter(mod => mod.roles.includes(userRole));

    return (
        <div className="h-full overflow-y-auto p-6 animate-fade-in-up">
            <div className="max-w-full mx-auto px-6">
                {/* Header centralizado */}
                <div className="text-center mb-10 mt-8">
                    <h2 className="text-4xl font-extrabold text-slate-900 dark:text-white mb-3">
                        Painel de Controle
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-3xl mx-auto text-lg leading-relaxed">
                        A primeira plataforma de Gestão de Mensagens para Clínicas.
                        Centralize WhatsApp e Instagram em um só lugar. Automatize o
                        atendimento, aumente suas vendas e transforme conversas em
                        pacientes fidelizados.
                    </p>
                </div>

                {/* Grid de Módulos — centralizado para qualquer quantidade */}
                <div className={`flex flex-wrap justify-center gap-6 pb-10 ${visibleModules.length <= 3 ? 'max-w-3xl mx-auto' : ''}`}>
                    {visibleModules.map((mod, idx) => (
                        <div key={idx} className="w-full sm:w-[calc(50%-12px)] md:w-[calc(33.333%-16px)] lg:w-[220px]">
                            <ModuleCard
                                {...mod}
                                onClick={() => router.push(mod.path)}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
