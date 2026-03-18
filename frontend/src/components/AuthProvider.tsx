'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { fetchApi } from '@/lib/api';

type User = {
    id: number;
    username: string;
    role: string;
    pipeline_id: number;
    meta_token: string | null;
    ig_page_id: string | null;
};

type AuthContextType = {
    user: User | null;
    isLoading: boolean;
    logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
    user: null,
    isLoading: true,
    logout: async () => { },
});

// Rotas restritas por role — tier2 NÃO pode acessar estas páginas
const ADMIN_ONLY_ROUTES = ['/financeiro', '/relatorios'];
const TIER1_ROUTES = ['/financeiro'];

function isRouteBlocked(pathname: string, role: string): boolean {
    if (role === 'admin') return false;
    if (role === 'tier2') {
        return ADMIN_ONLY_ROUTES.some(r => pathname.startsWith(r));
    }
    // tier1 tem acesso intermediário
    return false;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        let mounted = true;

        const checkAuth = async () => {
            try {
                const res = await fetchApi('/auth/me');
                if (mounted) {
                    if (res.authenticated) {
                        setUser(res.user);
                        // Bloquear rota se tier não tem permissão
                        if (isRouteBlocked(pathname, res.user.role)) {
                            router.push('/hub');
                        } else if (pathname === '/') {
                            router.push('/hub');
                        }
                    } else {
                        setUser(null);
                        if (pathname !== '/') {
                            router.push('/');
                        }
                    }
                }
            } catch (err) {
                if (mounted) {
                    setUser(null);
                    if (pathname !== '/') {
                        router.push('/');
                    }
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };

        checkAuth();

        return () => {
            mounted = false;
        };
    }, [pathname, router]);

    const logout = async () => {
        try {
            await fetchApi('/auth/logout', { method: 'POST' });
        } finally {
            setUser(null);
            // Limpeza total: localStorage, sessionStorage, cookies
            try { localStorage.clear(); } catch {}
            try { sessionStorage.clear(); } catch {}
            // Hard redirect para garantir que nenhum estado em memória sobreviva
            window.location.href = '/';
        }
    };

    // Bloquear renderização de rotas restritas
    const blocked = user && isRouteBlocked(pathname, user.role);

    return (
        <AuthContext.Provider value={{ user, isLoading, logout }}>
            {isLoading && pathname !== '/' ? (
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                    <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-xl shadow-brand/20 animate-pulse">
                        K
                    </div>
                </div>
            ) : blocked ? (
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                    <div className="text-center p-8">
                        <p className="text-lg text-red-500 font-semibold">Acesso negado</p>
                        <p className="text-slate-400 mt-2">Você não tem permissão para acessar esta página.</p>
                    </div>
                </div>
            ) : (
                children
            )}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
