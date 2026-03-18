'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';

type BudgetStatus = 'PENDENTE' | 'APROVADO' | 'REJEITADO';
type Filter = 'ALL' | BudgetStatus;

type Budget = {
    id: number;
    patient_name: string;
    cpf: string;
    phone: string;
    procedure: string;
    amount: number;
    status: BudgetStatus;
    created_at: string;
};

const FILTERS: Filter[] = ['ALL', 'PENDENTE', 'APROVADO', 'REJEITADO'];

export default function FinancePage() {
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [kpis, setKpis] = useState({ approved: 0, pending: 0, rejected: 0, total: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>('ALL');
    const [showNewBudgetModal, setShowNewBudgetModal] = useState(false);
    const [newBudget, setNewBudget] = useState({ patient_name: '', cpf: '', phone: '', procedure: '', amount: '' });

    const loadData = () => {
        setIsLoading(true);
        fetchApi('/finance/data')
            .then(data => {
                if (!data.error) {
                    setBudgets((data.budgets || []) as Budget[]);
                    if (data.kpis) setKpis(data.kpis);
                }
            })
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    };

    useEffect(() => { loadData(); }, []);

    const handleUpdateStatus = async (id: number, newStatus: BudgetStatus) => {
        setBudgets(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b));
        try {
            await fetchApi('/finance/budget/update', {
                method: 'POST',
                body: JSON.stringify({ id, status: newStatus })
            });
            loadData();
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Excluir este orçamento?')) return;
        setBudgets(prev => prev.filter(b => b.id !== id));
        try {
            await fetchApi('/finance/budget/delete', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            loadData();
        } catch (err) {
            console.error(err);
        }
    };

    const handleCreateBudget = async () => {
        if (!newBudget.patient_name.trim() || !newBudget.amount) return;
        try {
            const res = await fetchApi('/finance/budget', {
                method: 'POST',
                body: JSON.stringify({
                    ...newBudget,
                    amount: parseFloat(newBudget.amount) || 0
                })
            });
            if (res.success) {
                setNewBudget({ patient_name: '', cpf: '', phone: '', procedure: '', amount: '' });
                setShowNewBudgetModal(false);
                loadData();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const filteredBudgets = budgets.filter(b => filter === 'ALL' ? true : b.status === filter);

    const getStatusColor = (status: BudgetStatus) => {
        if (status === 'APROVADO') return 'text-green-500 bg-green-500/10 border-green-500/20';
        if (status === 'REJEITADO') return 'text-red-500 bg-red-500/10 border-red-500/20';
        return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900">
            <div className="p-6 md:p-8 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10 backdrop-blur-md">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-3">
                        <i className="fas fa-wallet text-brand"></i> Controle Financeiro
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestão de orçamentos e previsão de recebíveis.</p>
                </div>
                <button
                    onClick={() => setShowNewBudgetModal(true)}
                    className="bg-brand hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-brand/20 transition cursor-pointer flex items-center gap-2"
                >
                    <i className="fas fa-plus"></i> Novo Orçamento
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="max-w-[1400px] mx-auto space-y-8">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Total Orçado</p>
                                    <h3 className="text-2xl font-black text-slate-900 dark:text-white">R$ {kpis.total.toLocaleString('pt-BR')}</h3>
                                </div>
                                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center">
                                    <i className="fas fa-calculator"></i>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 rounded-full blur-2xl group-hover:bg-green-500/10 transition-all"></div>
                            <div className="flex justify-between items-start relative z-10">
                                <div>
                                    <p className="text-xs font-bold text-green-500/70 uppercase tracking-widest mb-1">Aprovados</p>
                                    <h3 className="text-2xl font-black text-green-400">R$ {kpis.approved.toLocaleString('pt-BR')}</h3>
                                </div>
                                <div className="w-10 h-10 rounded-lg bg-green-500/20 text-green-500 flex items-center justify-center">
                                    <i className="fas fa-check-circle"></i>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all"></div>
                            <div className="flex justify-between items-start relative z-10">
                                <div>
                                    <p className="text-xs font-bold text-amber-500/70 uppercase tracking-widest mb-1">Pendentes</p>
                                    <h3 className="text-2xl font-black text-amber-400">R$ {kpis.pending.toLocaleString('pt-BR')}</h3>
                                </div>
                                <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-500 flex items-center justify-center">
                                    <i className="fas fa-clock"></i>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-all"></div>
                            <div className="flex justify-between items-start relative z-10">
                                <div>
                                    <p className="text-xs font-bold text-red-500/70 uppercase tracking-widest mb-1">Rejeitados</p>
                                    <h3 className="text-2xl font-black text-red-400">R$ {kpis.rejected.toLocaleString('pt-BR')}</h3>
                                </div>
                                <div className="w-10 h-10 rounded-lg bg-red-500/20 text-red-500 flex items-center justify-center">
                                    <i className="fas fa-times-circle"></i>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Table Section */}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between gap-4 items-center bg-slate-50/50 dark:bg-slate-800/50">
                            <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg">
                                {FILTERS.map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setFilter(f)}
                                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${filter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                    >
                                        {f === 'ALL' ? 'Todos' : f}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                        <th className="p-4 font-bold">Data</th>
                                        <th className="p-4 font-bold">Paciente</th>
                                        <th className="p-4 font-bold">Procedimento</th>
                                        <th className="p-4 font-bold">Valor</th>
                                        <th className="p-4 font-bold">Status</th>
                                        <th className="p-4 font-bold text-center">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
                                    {isLoading ? (
                                        <tr><td colSpan={6} className="p-10 text-center"><i className="fas fa-circle-notch fa-spin text-brand text-xl"></i></td></tr>
                                    ) : filteredBudgets.length === 0 ? (
                                        <tr><td colSpan={6} className="p-10 text-center text-slate-500">Nenhum orçamento encontrado.</td></tr>
                                    ) : filteredBudgets.map(b => (
                                        <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition group">
                                            <td className="p-4 text-sm text-slate-500 dark:text-slate-400">{new Date(b.created_at).toLocaleDateString('pt-BR')}</td>
                                            <td className="p-4 text-sm font-bold text-slate-900 dark:text-white">{b.patient_name}</td>
                                            <td className="p-4 text-sm text-slate-600 dark:text-slate-300">{b.procedure}</td>
                                            <td className="p-4 text-sm font-bold text-slate-900 dark:text-white">R$ {b.amount.toLocaleString('pt-BR')}</td>
                                            <td className="p-4">
                                                <span className={`px-3 py-1 text-[10px] font-bold rounded border ${getStatusColor(b.status)}`}>
                                                    {b.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition">
                                                    {b.status === 'PENDENTE' && (
                                                        <>
                                                            <button onClick={() => handleUpdateStatus(b.id, 'APROVADO')} className="w-8 h-8 rounded bg-green-500/20 text-green-500 hover:bg-green-500 hover:text-white transition cursor-pointer" title="Aprovar">
                                                                <i className="fas fa-check"></i>
                                                            </button>
                                                            <button onClick={() => handleUpdateStatus(b.id, 'REJEITADO')} className="w-8 h-8 rounded bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition cursor-pointer" title="Rejeitar">
                                                                <i className="fas fa-times"></i>
                                                            </button>
                                                        </>
                                                    )}
                                                    <button onClick={() => handleDelete(b.id)} className="w-8 h-8 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-white transition cursor-pointer" title="Excluir">
                                                        <i className="far fa-trash-alt"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* New Budget Modal */}
            {showNewBudgetModal && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowNewBudgetModal(false)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[500px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white"><i className="fas fa-file-invoice-dollar text-brand mr-2"></i>Novo Orçamento</h3>
                            <button onClick={() => setShowNewBudgetModal(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Paciente *</label>
                                <input value={newBudget.patient_name} onChange={e => setNewBudget({ ...newBudget, patient_name: e.target.value })} placeholder="Nome do paciente" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500" autoFocus />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block font-bold">CPF</label>
                                    <input value={newBudget.cpf} onChange={e => setNewBudget({ ...newBudget, cpf: e.target.value })} placeholder="000.000.000-00" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block font-bold">Telefone</label>
                                    <input value={newBudget.phone} onChange={e => setNewBudget({ ...newBudget, phone: e.target.value })} placeholder="(00) 00000-0000" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Procedimento</label>
                                <input value={newBudget.procedure} onChange={e => setNewBudget({ ...newBudget, procedure: e.target.value })} placeholder="Ex: Limpeza, Canal, Estética..." className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Valor (R$) *</label>
                                <input type="number" value={newBudget.amount} onChange={e => setNewBudget({ ...newBudget, amount: e.target.value })} placeholder="0.00" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500" />
                            </div>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button onClick={handleCreateBudget} disabled={!newBudget.patient_name.trim() || !newBudget.amount} className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-50 shadow-lg shadow-brand/20">
                                <i className="fas fa-plus mr-2"></i>Criar Orçamento
                            </button>
                            <button onClick={() => setShowNewBudgetModal(false)} className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer">Cancelar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
