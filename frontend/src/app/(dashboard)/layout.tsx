'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import NotificationProvider from '@/components/NotificationProvider';
import { useAuth } from '@/components/AuthProvider';

const ALL_NAV_ITEMS = [
    { key: 'hub', label: 'Hub', icon: 'fas fa-th-large', path: '/hub', roles: ['admin', 'tier1', 'tier2'] },
    { key: 'leads', label: 'Leads', icon: 'fas fa-comments', path: '/leads', roles: ['admin', 'tier1', 'tier2'] },
    { key: 'chat', label: 'Chat', icon: 'fab fa-whatsapp', path: '/chat', roles: ['admin', 'tier1'] },
    { key: 'agenda', label: 'Agenda', icon: 'far fa-calendar-alt', path: '/agenda', roles: ['admin', 'tier1'] },
    { key: 'relatorios', label: 'Relatórios', icon: 'fas fa-chart-pie', path: '/relatorios', roles: ['admin', 'tier1', 'tier2'] },
    { key: 'financeiro', label: 'Financeiro', icon: 'fas fa-wallet', path: '/financeiro', roles: ['admin', 'tier1'] },
    { key: 'usuarios', label: 'Usuários', icon: 'fas fa-users-cog', path: '/usuarios', roles: ['admin'] },
    { key: 'suporte', label: 'Suporte', icon: 'fas fa-graduation-cap', path: '/suporte', roles: ['admin', 'tier1', 'tier2'] },
];

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { user } = useAuth();
    const userRole = user?.role || 'tier2';

    const navItems = ALL_NAV_ITEMS
        .filter(item => item.roles.includes(userRole))
        .map(({ roles, ...rest }) => rest);

    return (
        <NotificationProvider>
            <div className="flex flex-col h-screen">
                <Header
                    onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
                    navItems={navItems}
                    isSidebarOpen={isSidebarOpen}
                    onCloseSidebar={() => setIsSidebarOpen(false)}
                />
                <main className="flex-1 overflow-hidden relative">
                    {children}
                </main>
            </div>
        </NotificationProvider>
    );
}
