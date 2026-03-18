'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/AuthProvider';
import { fetchApi } from '@/lib/api';
import { useNotification } from '@/components/NotificationProvider';

type Notification = { id: number; name: string; last_msg: string; profile_pic: string; unread_count: number };
type Activity = { id: number; description: string; details: string; created_at: string };
type NavItem = { key: string; label: string; icon: string; path: string };

interface HeaderProps {
    onToggleSidebar: () => void;
    navItems: NavItem[];
    isSidebarOpen: boolean;
    onCloseSidebar: () => void;
}

export default function Header({ onToggleSidebar, navItems, isSidebarOpen, onCloseSidebar }: HeaderProps) {
    const router = useRouter();
    const pathname = usePathname();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [showNotif, setShowNotif] = useState(false);
    const [showActivity, setShowActivity] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const profileRef = useRef<HTMLDivElement>(null);
    const notifRef = useRef<HTMLDivElement>(null);
    const { user, logout } = useAuth();
    const { hasNewMessage, clearNotification } = useNotification();

    const totalUnread = notifications.reduce((sum, n) => sum + (n.unread_count || 0), 0);
    const notifPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const fetchNotifications = () => {
        fetchApi('/notifications')
            .then(data => { if (data.notifs) setNotifications(data.notifs); })
            .catch(() => {});
    };

    useEffect(() => {
        fetchNotifications();
        fetchApi('/activities')
            .then(data => { if (data.activities) setActivities(data.activities); })
            .catch(() => {});

        // Polling notificações a cada 5s
        notifPollingRef.current = setInterval(fetchNotifications, 5000);
        return () => {
            if (notifPollingRef.current) clearInterval(notifPollingRef.current);
        };
    }, []);

    const handleClearNotifications = async () => {
        setNotifications([]);
        try { await fetchApi('/notifications/clear', { method: 'POST' }); } catch { /* silent */ }
    };

    const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

    const navigateTo = (path: string) => {
        router.push(path);
        onCloseSidebar();
    };

    return (
        <>
            {/* ===== TOP BAR ===== */}
            <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 h-16 flex items-center justify-between px-4 lg:px-6 z-30 shrink-0 shadow-sm relative transition-colors">
                {/* Left — Hamburger + Logo */}
                <div className="flex items-center gap-3 h-full">
                    {/* Hamburger */}
                    <button
                        onClick={onToggleSidebar}
                        className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
                        title="Menu"
                    >
                        <i className={`fas ${isSidebarOpen ? 'fa-times' : 'fa-bars'} text-base`}></i>
                    </button>

                    {/* Logo (also toggles sidebar) */}
                    <div
                        className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition group"
                        onClick={onToggleSidebar}
                    >
                        <div className="w-9 h-9 bg-brand rounded-lg flex items-center justify-center text-white font-bold text-xl shadow transform group-active:scale-95 transition-transform">
                            K
                        </div>
                        <div className="leading-tight hidden sm:block">
                            <h1 className="font-bold text-slate-900 dark:text-white text-lg">
                                <span className="text-brand">Keep</span>Medica
                            </h1>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded transition-colors">
                                V.2.0
                            </span>
                        </div>
                    </div>
                </div>

                {/* Right — Actions */}
                <div className="flex items-center gap-2 lg:gap-3">
                    {/* Theme Toggle */}
                    {mounted && (
                        <button
                            onClick={toggleTheme}
                            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
                            title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
                        >
                            <i className={`${theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'} text-sm`}></i>
                        </button>
                    )}

                    {/* Activity Log */}
                    <button
                        onClick={() => setShowActivity(!showActivity)}
                        className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
                    >
                        <i className="fas fa-history text-sm"></i>
                    </button>

                    {/* Notifications */}
                    <div className="relative" ref={notifRef}>
                        <button
                            onClick={() => { setShowNotif(!showNotif); clearNotification(); }}
                            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-white transition relative cursor-pointer"
                        >
                            <i className={`fas fa-bell text-sm ${hasNewMessage ? 'text-amber-500 animate-bounce' : ''}`}></i>
                            {/* Ping animation for new messages */}
                            {hasNewMessage && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500"></span>
                                </span>
                            )}
                            {!hasNewMessage && totalUnread > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-white dark:border-slate-800">
                                    {totalUnread > 99 ? '99+' : totalUnread}
                                </span>
                            )}
                        </button>
                        {showNotif && (
                            <div className="notif-portal animate-fade-in-up !bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700">
                                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
                                    <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                        <i className="fas fa-bell text-brand text-sm"></i> Notificações
                                        {totalUnread > 0 && (
                                            <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">{totalUnread}</span>
                                        )}
                                    </span>
                                    {notifications.length > 0 && (
                                        <button onClick={handleClearNotifications} className="text-xs text-brand hover:underline cursor-pointer">
                                            Limpar todas
                                        </button>
                                    )}
                                </div>
                                <div className="overflow-y-auto max-h-[350px]">
                                    {notifications.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                                            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                                                <i className="fas fa-bell-slash text-slate-300 dark:text-slate-600 text-lg"></i>
                                            </div>
                                            <p className="text-sm text-slate-400 dark:text-slate-500">Nenhuma notificação nova.</p>
                                            <p className="text-[11px] text-slate-300 dark:text-slate-600 mt-1">As mensagens dos leads aparecerão aqui.</p>
                                        </div>
                                    ) : notifications.map(n => (
                                        <div key={n.id} onClick={() => { router.push(`/leads?openChat=${n.id}`); setShowNotif(false); }} className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition cursor-pointer bg-brand/5 dark:bg-brand/5">
                                            <div className="flex items-center gap-3">
                                                {n.profile_pic ? (
                                                    <img src={n.profile_pic} alt={n.name} className="w-9 h-9 rounded-full shrink-0 object-cover" />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-full bg-brand/15 flex items-center justify-center text-brand font-bold text-sm shrink-0">
                                                        {n.name?.charAt(0).toUpperCase() || '?'}
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{n.name}</p>
                                                        <span className="bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shrink-0">
                                                            {n.unread_count}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                        {n.last_msg || 'Nova mensagem'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Profile */}
                    <div className="relative" ref={profileRef}>
                        <div
                            onClick={() => setShowProfile(!showProfile)}
                            className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 pl-1.5 pr-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 shadow-sm cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition active:scale-95"
                        >
                            <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-white font-bold text-xs uppercase">
                                {user?.username?.charAt(0) || 'U'}
                            </div>
                            <span className="font-medium text-xs hidden sm:inline">{user?.username || 'Usuário'}</span>
                        </div>
                        {showProfile && (
                            <div className="profile-menu animate-fade-in-up !bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700">
                                <div className="flex flex-col items-center px-6 py-4 border-b border-slate-200 dark:border-slate-700 mb-3 text-center">
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Conta Atual</p>
                                    <div className="w-16 h-16 rounded-full bg-brand flex items-center justify-center text-white font-bold text-2xl shadow-lg mb-3 border-4 border-slate-100 dark:border-slate-700 uppercase">
                                        {user?.username?.charAt(0) || 'U'}
                                    </div>
                                    <h4 className="text-base font-bold text-slate-900 dark:text-white">{user?.username || 'Usuário'}</h4>
                                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full mt-1.5 ${
                                        user?.role === 'admin'
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                            : user?.role === 'tier1'
                                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                : 'bg-brand/10 text-brand dark:bg-brand/20'
                                    }`}>
                                        {user?.role === 'admin' && <i className="fas fa-crown text-[8px]"></i>}
                                        {user?.role === 'admin' ? 'Administrador' : user?.role === 'tier1' ? 'Acesso Completo' : 'Acesso Básico'}
                                    </span>
                                    <span className="text-xs text-green-500 font-medium flex items-center gap-1 mt-1.5">
                                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Online
                                    </span>
                                </div>
                                <div className="py-1">
                                    <button
                                        onClick={() => logout()}
                                        className="flex items-center justify-center gap-3 px-4 py-4 text-sm text-red-500 font-bold transition-all cursor-pointer border-t border-slate-200 dark:border-slate-700 mt-2 w-full hover:text-red-400"
                                    >
                                        <i className="fas fa-sign-out-alt"></i> Sair do sistema
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </header>

            {/* ===== SIDEBAR DRAWER (Overlay) ===== */}
            {/* Dark overlay */}
            <div
                className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onCloseSidebar}
            />

            {/* Sliding drawer */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                {/* Drawer header */}
                <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-brand rounded-lg flex items-center justify-center text-white font-bold text-xl shadow">
                            K
                        </div>
                        <div className="leading-tight">
                            <h1 className="font-bold text-slate-900 dark:text-white text-lg">
                                <span className="text-brand">Keep</span>Medica
                            </h1>
                        </div>
                    </div>
                    <button
                        onClick={onCloseSidebar}
                        className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
                    >
                        <i className="fas fa-times text-sm"></i>
                    </button>
                </div>

                {/* Navigation links */}
                <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest px-3 mb-3">
                        Navegação
                    </p>
                    {navItems.map((item) => {
                        const isActive = pathname.startsWith(item.path);
                        return (
                            <button
                                key={item.key}
                                onClick={() => navigateTo(item.path)}
                                className={`
                                    w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 cursor-pointer select-none group relative
                                    ${isActive
                                        ? 'bg-brand/10 text-brand font-bold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }
                                `}
                            >
                                {/* Active indicator bar */}
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 bg-brand rounded-r-full" />
                                )}
                                <i className={`${item.icon} text-base w-5 text-center ${isActive ? 'text-brand' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}></i>
                                <span className="text-sm font-semibold">{item.label}</span>
                                {isActive && (
                                    <div className="ml-auto w-2 h-2 rounded-full bg-brand"></div>
                                )}
                            </button>
                        );
                    })}
                </nav>

                {/* Drawer footer */}
                <div className="border-t border-slate-200 dark:border-slate-700 p-4 shrink-0">
                    <div className="flex items-center gap-3 px-2">
                        <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm uppercase">
                            {user?.username?.charAt(0) || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user?.username || 'Usuário'}</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{user?.role === 'admin' ? 'Administrador' : user?.role === 'tier1' ? 'Acesso Completo' : 'Acesso Básico'}</p>
                        </div>
                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shrink-0"></span>
                    </div>
                </div>
            </aside>

            {/* ===== ACTIVITY PANEL (Slide-in from right) ===== */}
            <div
                className={`fixed top-0 right-0 w-[400px] h-screen bg-white dark:bg-slate-800 z-[2000] shadow-[-5px_0_25px_rgba(0,0,0,0.1)] dark:shadow-[-5px_0_25px_rgba(0,0,0,0.3)] flex flex-col transition-transform duration-300 ${showActivity ? 'translate-x-0' : 'translate-x-full'}`}
            >
                <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-slate-900 dark:text-white text-lg flex items-center gap-2">
                        <i className="fas fa-history text-brand"></i> Atividade Recente
                    </h3>
                    <button
                        onClick={() => setShowActivity(false)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer transition"
                    >
                        &times;
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {activities.length === 0 ? (
                        <p className="text-center text-slate-400 dark:text-slate-500 text-sm py-10">Nenhuma atividade recente.</p>
                    ) : activities.map((act) => (
                        <div key={act.id} className="activity-item relative pl-10 pb-4">
                            <div className="absolute left-2 top-1 w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center z-10">
                                <i className="fas fa-bolt text-brand text-xs"></i>
                            </div>
                            <p className="text-sm text-slate-700 dark:text-slate-200 font-medium" dangerouslySetInnerHTML={{ __html: act.description }}></p>
                            {act.details && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{act.details}</p>}
                            <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">
                                {new Date(act.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
            {showActivity && (
                <div className="fixed inset-0 bg-black/20 dark:bg-black/30 z-[1999]" onClick={() => setShowActivity(false)}></div>
            )}

        </>
    );
}
