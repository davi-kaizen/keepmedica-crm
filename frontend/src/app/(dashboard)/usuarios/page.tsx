'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchApi } from '@/lib/api';

type SystemUser = {
    id: number;
    username: string;
    role: string;
    cpf: string;
    phone: string;
    pipeline_id: number;
};

const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrador',
    tier1: 'Tier 1 — Acesso Completo',
    tier2: 'Tier 2 — Acesso Restrito',
};

const ROLE_BADGES: Record<string, string> = {
    admin: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    tier1: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    tier2: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export default function UsuariosPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<SystemUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

    // Guard: redirect non-admins
    useEffect(() => {
        if (user && user.role !== 'admin') {
            router.replace('/hub');
        }
    }, [user, router]);

    const fetchUsers = async () => {
        try {
            const res = await fetchApi('/admin/users');
            if (res.users) setUsers(res.users);
        } catch { /* silent */ }
        setLoading(false);
    };

    useEffect(() => {
        if (user?.role === 'admin') fetchUsers();
    }, [user]);

    const handleRoleChange = async (uid: number, newRole: string) => {
        setSavingId(uid);
        try {
            await fetchApi('/admin/update_role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: uid, role: newRole }),
            });
            setUsers(prev => prev.map(u => u.id === uid ? { ...u, role: newRole } : u));
        } catch { /* silent */ }
        setSavingId(null);
    };

    const handleFieldChange = async (uid: number, field: 'cpf' | 'phone', value: string) => {
        setUsers(prev => prev.map(u => u.id === uid ? { ...u, [field]: value } : u));
    };

    const handleFieldSave = async (uid: number, field: 'cpf' | 'phone', value: string) => {
        try {
            await fetchApi('/admin/update_role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: uid, [field]: value }),
            });
        } catch { /* silent */ }
    };

    const handleDelete = async (uid: number) => {
        setDeletingId(uid);
        try {
            await fetchApi('/admin/users/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: uid }),
            });
            setUsers(prev => prev.filter(u => u.id !== uid));
        } catch { /* silent */ }
        setDeletingId(null);
        setConfirmDelete(null);
    };

    if (user?.role !== 'admin') {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
                        <i className="fas fa-lock text-red-500 text-2xl"></i>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Acesso Negado</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Apenas administradores podem acessar esta página.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6 animate-fade-in-up">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                                <i className="fas fa-users-cog text-brand"></i>
                            </div>
                            Gestão de Usuários
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 ml-[52px]">
                            Gerencie permissões e níveis de acesso dos operadores do sistema.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                        <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-medium">
                            {users.length} usuário{users.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>

                {/* Tier Legend */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <i className="fas fa-crown text-amber-500 text-sm"></i>
                            <span className="font-bold text-amber-700 dark:text-amber-400 text-sm">Admin</span>
                        </div>
                        <p className="text-xs text-amber-600/70 dark:text-amber-400/50">Acesso total, incluindo gestão de usuários</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <i className="fas fa-shield-alt text-emerald-500 text-sm"></i>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">Tier 1</span>
                        </div>
                        <p className="text-xs text-emerald-600/70 dark:text-emerald-400/50">Leads, Chat, Agenda, Relatórios, Financeiro, Suporte</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <i className="fas fa-user text-slate-500 text-sm"></i>
                            <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">Tier 2</span>
                        </div>
                        <p className="text-xs text-slate-500/70 dark:text-slate-400/50">Apenas Leads, Relatórios e Suporte</p>
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-3 border-brand border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                                    <th className="text-left text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-6 py-4">Usuário</th>
                                    <th className="text-left text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-6 py-4">CPF</th>
                                    <th className="text-left text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-6 py-4">Telefone</th>
                                    <th className="text-left text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-6 py-4">Nível de Acesso</th>
                                    <th className="text-right text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-6 py-4">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {users.map((u) => (
                                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                        {/* Nome */}
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm uppercase shrink-0 ${u.role === 'admin' ? 'bg-amber-500' : 'bg-brand'}`}>
                                                    {u.username.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{u.username}</p>
                                                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${ROLE_BADGES[u.role] || ROLE_BADGES.tier2}`}>
                                                        {u.role === 'admin' && <i className="fas fa-crown text-[8px]"></i>}
                                                        {ROLE_LABELS[u.role] || u.role}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        {/* CPF */}
                                        <td className="px-6 py-4">
                                            <input
                                                type="text"
                                                value={u.cpf || ''}
                                                onChange={(e) => handleFieldChange(u.id, 'cpf', e.target.value)}
                                                onBlur={(e) => handleFieldSave(u.id, 'cpf', e.target.value)}
                                                placeholder="000.000.000-00"
                                                className="text-sm text-slate-700 dark:text-slate-300 bg-transparent outline-none w-36 placeholder-slate-300 dark:placeholder-slate-600 border-b border-transparent hover:border-slate-200 dark:hover:border-slate-600 focus:border-brand transition-colors"
                                            />
                                        </td>
                                        {/* Telefone */}
                                        <td className="px-6 py-4">
                                            <input
                                                type="text"
                                                value={u.phone || ''}
                                                onChange={(e) => handleFieldChange(u.id, 'phone', e.target.value)}
                                                onBlur={(e) => handleFieldSave(u.id, 'phone', e.target.value)}
                                                placeholder="(00) 00000-0000"
                                                className="text-sm text-slate-700 dark:text-slate-300 bg-transparent outline-none w-40 placeholder-slate-300 dark:placeholder-slate-600 border-b border-transparent hover:border-slate-200 dark:hover:border-slate-600 focus:border-brand transition-colors"
                                            />
                                        </td>
                                        {/* Role Selector */}
                                        <td className="px-6 py-4">
                                            {u.id === user?.id ? (
                                                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg ${ROLE_BADGES[u.role] || ROLE_BADGES.tier2}`}>
                                                    {u.role === 'admin' && <i className="fas fa-crown text-[10px]"></i>}
                                                    {ROLE_LABELS[u.role] || u.role}
                                                    <span className="text-[9px] opacity-60 ml-1">(você)</span>
                                                </span>
                                            ) : (
                                                <div className="relative">
                                                    <select
                                                        value={u.role}
                                                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                                        disabled={savingId === u.id}
                                                        className="appearance-none bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all cursor-pointer disabled:opacity-50"
                                                    >
                                                        <option value="admin">Admin</option>
                                                        <option value="tier1">Tier 1 — Completo</option>
                                                        <option value="tier2">Tier 2 — Restrito</option>
                                                    </select>
                                                    {/* seta removida */}
                                                    {savingId === u.id && (
                                                        <div className="absolute -right-6 top-1/2 -translate-y-1/2">
                                                            <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin"></div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        {/* Ações */}
                                        <td className="px-6 py-4 text-right">
                                            {u.id === user?.id ? (
                                                <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
                                            ) : confirmDelete === u.id ? (
                                                <div className="inline-flex items-center gap-2">
                                                    <span className="text-xs text-red-500 font-medium">Confirmar?</span>
                                                    <button
                                                        onClick={() => handleDelete(u.id)}
                                                        disabled={deletingId === u.id}
                                                        className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-lg transition cursor-pointer disabled:opacity-50"
                                                    >
                                                        {deletingId === u.id ? <i className="fas fa-circle-notch fa-spin"></i> : 'Sim'}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDelete(null)}
                                                        className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-2 py-1 rounded-lg transition cursor-pointer"
                                                    >
                                                        Não
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDelete(u.id)}
                                                    className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition cursor-pointer p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                                                    title="Excluir conta"
                                                >
                                                    <i className="fas fa-trash-alt text-sm"></i>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {users.length === 0 && (
                            <div className="text-center py-16">
                                <i className="fas fa-users text-slate-300 dark:text-slate-600 text-3xl mb-3"></i>
                                <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum usuário cadastrado.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
