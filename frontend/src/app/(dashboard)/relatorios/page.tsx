'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchApi } from '@/lib/api';

type DailySummary = {
    date: string;
    seller: string;
    doctor: string;
    ig_username: string;
    ativacoes: number;
    respostas: number;
    taxa_resposta: number;
    follows: number;
    conversoes: number;
    taxa_conversao: number;
    receita_dia: number;
    funnel: { stage: string; count: number }[];
    observations: string;
    stage_names: string[];
};

function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
        <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${pct}%`, backgroundColor: color }}
            />
        </div>
    );
}

export default function ReportsPage() {
    const [data, setData] = useState<DailySummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(() => {
        const now = new Date();
        return now.toISOString().split('T')[0]; // YYYY-MM-DD
    });
    const [observations, setObservations] = useState('');
    const [savingNotes, setSavingNotes] = useState(false);
    const [notesSaved, setNotesSaved] = useState(false);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const [copiedText, setCopiedText] = useState(false);
    const [doctorName, setDoctorName] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('keepmedica_doctor_name') || '';
        }
        return '';
    });
    const [responsavel, setResponsavel] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('keepmedica_responsavel_name') || '';
        }
        return '';
    });

    const fetchReport = useCallback(async (date: string) => {
        setIsLoading(true);
        try {
            const res = await fetchApi(`/reports/daily_summary?date=${date}`);
            if (res.success) {
                setData(res);
                setObservations(res.observations || '');
                // Preencher doctor do backend apenas se localStorage estiver vazio
                if (!doctorName && res.doctor) {
                    setDoctorName(res.doctor);
                    localStorage.setItem('keepmedica_doctor_name', res.doctor);
                }
                if (!responsavel && res.seller) {
                    setResponsavel(res.seller);
                    localStorage.setItem('keepmedica_responsavel_name', res.seller);
                }
            }
        } catch { /* silent */ }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchReport(selectedDate);
    }, [selectedDate, fetchReport]);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedDate(e.target.value);
    };

    const handleDateNav = (dir: -1 | 1) => {
        const d = new Date(selectedDate + 'T12:00:00');
        d.setDate(d.getDate() + dir);
        setSelectedDate(d.toISOString().split('T')[0]);
    };

    // Auto-save observations with debounce
    const handleObservationsChange = (value: string) => {
        setObservations(value);
        setNotesSaved(false);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
            setSavingNotes(true);
            try {
                await fetchApi('/reports/save_notes', {
                    method: 'POST',
                    body: JSON.stringify({ date: selectedDate, notes: value }),
                });
                setNotesSaved(true);
                setTimeout(() => setNotesSaved(false), 2000);
            } catch { /* silent */ }
            setSavingNotes(false);
        }, 1000);
    };

    // CSV Export
    const handleExportCSV = () => {
        if (!data) return;
        const sep = ';';
        const lines: string[] = [];

        lines.push(`Relatorio KeepMedica - ${formatDateBR(data.date)}`);
        lines.push('');
        lines.push(['Metrica', 'Valor'].join(sep));
        lines.push(['Data', formatDateBR(data.date)].join(sep));
        lines.push(['Responsavel', responsavel || data.seller].join(sep));
        lines.push(['Doutor', doctorName || data.doctor].join(sep));
        lines.push(['Instagram', data.ig_username || 'N/A'].join(sep));
        lines.push('');
        lines.push(['Ativacoes (Novos Leads)', String(data.ativacoes)].join(sep));
        lines.push(['Respostas (Qualificacao/Proposta)', String(data.respostas)].join(sep));
        lines.push(['Taxa de Resposta (%)', String(data.taxa_resposta)].join(sep));
        lines.push(['Follow-ups', String(data.follows)].join(sep));
        lines.push(['Conversoes', String(data.conversoes)].join(sep));
        lines.push(['Taxa de Conversao (%)', String(data.taxa_conversao)].join(sep));
        lines.push(['Receita do Dia (R$)', data.receita_dia.toFixed(2).replace('.', ',')].join(sep));
        lines.push('');
        lines.push(['Etapa', 'Quantidade'].join(sep));
        for (const f of data.funnel) {
            lines.push([f.stage, String(f.count)].join(sep));
        }
        lines.push('');
        lines.push(['Observacoes', `"${(data.observations || observations).replace(/"/g, '""')}"`].join(sep));

        const BOM = '\uFEFF';
        const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Relatorio_KeepMedica_${data.date}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // WhatsApp Text Export (copy to clipboard)
    const handleCopyWhatsApp = async () => {
        if (!data) return;
        const dr = doctorName || data.doctor || '—';
        const lines = [
            `*📊 RELATÓRIO DIÁRIO*`,
            `*Dr ${dr} – (${formatDateBR(data.date)})*`,
            `*👤 Responsável: ${responsavel || data.seller}*`,
            ``,
            `📈 *Métricas:*`,
            `• Ativações (Novos): *${data.ativacoes}*`,
            `• Respostas: *${data.respostas}*`,
            `• Taxa de Resposta: *${data.taxa_resposta}%*`,
            `• Follow-ups: *${data.follows}*`,
            `• Conversões: *${data.conversoes}*`,
            `• Taxa de Conversão: *${data.taxa_conversao}%*`,
            `• Receita do Dia: *R$ ${data.receita_dia.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}*`,
        ];
        if (data.funnel.some(f => f.count > 0)) {
            lines.push(``, `📊 *Distribuição por Etapa:*`);
            for (const f of data.funnel) {
                lines.push(`• ${f.stage}: *${f.count}*`);
            }
        }
        const obs = observations || data.observations;
        if (obs) {
            lines.push(``, `📝 *Observações:* ${obs}`);
        }
        const text = lines.join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopiedText(true);
            setTimeout(() => setCopiedText(false), 2500);
        } catch { /* fallback */ }
        setShowExportMenu(false);
    };

    // Close export menu on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Derived values
    const maxFunnel = data ? Math.max(...data.funnel.map(f => f.count), 1) : 1;

    const STAGE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#ef4444', '#6366f1'];

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-[#0A0A0A]">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center animate-pulse">
                        <i className="fas fa-chart-pie text-brand text-lg"></i>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-600 font-medium">Carregando relatório...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-[#0A0A0A] overflow-y-auto">
            {/* ===== HEADER ===== */}
            <div className="shrink-0 sticky top-0 z-10 bg-slate-50/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800/60">
                <div className="max-w-[1100px] mx-auto w-full px-6 md:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                            <i className="fas fa-chart-line text-brand"></i>
                            Relatório de Performance
                        </h1>
                        <p className="text-[13px] text-slate-500 mt-0.5">Dashboard diário de produtividade</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Export Dropdown */}
                        <div className="relative" ref={exportMenuRef}>
                            <button
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                disabled={!data}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-2 shadow-sm shadow-blue-500/20 disabled:opacity-40"
                            >
                                <i className="fas fa-download"></i>
                                Exportar
                                <i className={`fas fa-chevron-down text-[8px] ml-0.5 transition-transform ${showExportMenu ? 'rotate-180' : ''}`}></i>
                            </button>
                            {showExportMenu && (
                                <div className="absolute top-full right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden min-w-[220px] animate-fade-in-up z-50">
                                    <button
                                        onClick={() => { handleExportCSV(); setShowExportMenu(false); }}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                                            <i className="fas fa-file-csv text-green-500 text-sm"></i>
                                        </div>
                                        <div className="text-left">
                                            <p className="font-bold">Arquivo CSV</p>
                                            <p className="text-[10px] text-slate-400">Download para Excel</p>
                                        </div>
                                    </button>
                                    <div className="border-t border-slate-100 dark:border-slate-700"></div>
                                    <button
                                        onClick={handleCopyWhatsApp}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                                            <i className="fab fa-whatsapp text-emerald-500 text-sm"></i>
                                        </div>
                                        <div className="text-left">
                                            <p className="font-bold">Copiar Texto (WhatsApp)</p>
                                            <p className="text-[10px] text-slate-400">Cola formatado no WhatsApp</p>
                                        </div>
                                    </button>
                                </div>
                            )}
                            {/* Copied feedback */}
                            {copiedText && (
                                <div className="absolute top-full right-0 mt-2 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg animate-fade-in-up z-50">
                                    <i className="fas fa-check mr-1"></i> Copiado!
                                </div>
                            )}
                        </div>

                        {/* Date Picker */}
                        <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                            <button
                                onClick={() => handleDateNav(-1)}
                                className="px-3 py-2 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                            >
                                <i className="fas fa-chevron-left text-xs"></i>
                            </button>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={handleDateChange}
                                className="bg-transparent text-sm font-medium text-slate-700 dark:text-white px-2 py-2 outline-none cursor-pointer [color-scheme:light] dark:[color-scheme:dark]"
                            />
                            <button
                                onClick={() => handleDateNav(1)}
                                className="px-3 py-2 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                            >
                                <i className="fas fa-chevron-right text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ===== CONTENT ===== */}
            <div className="flex-1 max-w-[1100px] mx-auto w-full px-6 md:px-8 py-6 space-y-5">

                {/* === TOP ROW: Seller/Dr Info === */}
                <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                        {/* Date */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                                <i className="far fa-calendar-alt text-brand"></i>
                            </div>
                            <div>
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Data</p>
                                <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDateBR(selectedDate)}</p>
                            </div>
                        </div>

                        <div className="w-px h-10 bg-slate-200 dark:bg-slate-800 hidden sm:block" />

                        {/* Doctor — Editable */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                                <i className="fas fa-user-md text-emerald-500"></i>
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    Doutor(a) <i className="fas fa-pen text-[7px] text-slate-300 dark:text-slate-600"></i>
                                </p>
                                <input
                                    type="text"
                                    value={doctorName}
                                    onChange={(e) => {
                                        setDoctorName(e.target.value);
                                        localStorage.setItem('keepmedica_doctor_name', e.target.value);
                                    }}
                                    placeholder="Digite o nome do Dr..."
                                    className="text-sm font-bold text-slate-900 dark:text-white bg-transparent outline-none w-full min-w-[160px] max-w-[260px] placeholder-slate-300 dark:placeholder-slate-600 border-b border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-brand transition-colors"
                                />
                            </div>
                        </div>

                        <div className="w-px h-10 bg-slate-200 dark:bg-slate-800 hidden sm:block" />

                        {/* Responsável — Editable */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                                <i className="fas fa-headset text-purple-500"></i>
                            </div>
                            <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    Responsável <i className="fas fa-pen text-[7px] text-slate-300 dark:text-slate-600"></i>
                                </p>
                                <input
                                    type="text"
                                    value={responsavel}
                                    onChange={(e) => {
                                        setResponsavel(e.target.value);
                                        localStorage.setItem('keepmedica_responsavel_name', e.target.value);
                                    }}
                                    placeholder="Digite o nome do responsável..."
                                    className="text-sm font-bold text-slate-900 dark:text-white bg-transparent outline-none w-full min-w-[160px] max-w-[260px] placeholder-slate-300 dark:placeholder-slate-600 border-b border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-brand transition-colors"
                                />
                            </div>
                        </div>

                        {data?.ig_username && (
                            <>
                                <div className="w-px h-10 bg-slate-200 dark:bg-slate-800 hidden sm:block" />
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
                                        <i className="fab fa-instagram text-pink-500"></i>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Instagram</p>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white">@{data.ig_username}</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* === METRICS GRID === */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Ativações */}
                    <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-blue-300 dark:hover:border-blue-800 transition-colors">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ativações</span>
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                <i className="fas fa-user-plus text-blue-500 text-xs"></i>
                            </div>
                        </div>
                        <p className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{data?.ativacoes ?? 0}</p>
                        <p className="text-[11px] text-slate-400 mt-1">Novos leads no dia</p>
                    </div>

                    {/* Respostas */}
                    <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-purple-300 dark:hover:border-purple-800 transition-colors">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Respostas</span>
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                <i className="fas fa-reply text-purple-500 text-xs"></i>
                            </div>
                        </div>
                        <p className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{data?.respostas ?? 0}</p>
                        <p className="text-[11px] text-slate-400 mt-1">Qualificação / Proposta</p>
                    </div>

                    {/* Follow-ups */}
                    <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:border-amber-300 dark:hover:border-amber-800 transition-colors">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Follow-ups</span>
                            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                                <i className="fas fa-redo text-amber-500 text-xs"></i>
                            </div>
                        </div>
                        <p className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{data?.follows ?? 0}</p>
                        <p className="text-[11px] text-slate-400 mt-1">Retornos pendentes</p>
                    </div>
                </div>

                {/* === CONVERSION RATES === */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* Taxa de Resposta */}
                    <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Taxa de Resposta</h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">Respostas / Ativações</p>
                            </div>
                            <span className={`text-2xl font-extrabold tracking-tight ${
                                (data?.taxa_resposta ?? 0) >= 50 ? 'text-emerald-500' :
                                (data?.taxa_resposta ?? 0) >= 25 ? 'text-amber-500' : 'text-slate-400'
                            }`}>
                                {data?.taxa_resposta ?? 0}%
                            </span>
                        </div>
                        <ProgressBar
                            value={data?.taxa_resposta ?? 0}
                            max={100}
                            color={(data?.taxa_resposta ?? 0) >= 50 ? '#10b981' : (data?.taxa_resposta ?? 0) >= 25 ? '#f59e0b' : '#94a3b8'}
                        />
                        <div className="flex justify-between mt-2">
                            <span className="text-[10px] text-slate-400">0%</span>
                            <span className="text-[10px] text-slate-400">50%</span>
                            <span className="text-[10px] text-slate-400">100%</span>
                        </div>
                    </div>

                    {/* Taxa de Conversão */}
                    <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Taxa de Conversão</h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">Negociação+Ganho / Ativações</p>
                            </div>
                            <span className={`text-2xl font-extrabold tracking-tight ${
                                (data?.taxa_conversao ?? 0) >= 30 ? 'text-emerald-500' :
                                (data?.taxa_conversao ?? 0) >= 10 ? 'text-amber-500' : 'text-slate-400'
                            }`}>
                                {data?.taxa_conversao ?? 0}%
                            </span>
                        </div>
                        <ProgressBar
                            value={data?.taxa_conversao ?? 0}
                            max={100}
                            color={(data?.taxa_conversao ?? 0) >= 30 ? '#10b981' : (data?.taxa_conversao ?? 0) >= 10 ? '#f59e0b' : '#94a3b8'}
                        />
                        <div className="flex justify-between mt-2">
                            <span className="text-[10px] text-slate-400">0%</span>
                            <span className="text-[10px] text-slate-400">50%</span>
                            <span className="text-[10px] text-slate-400">100%</span>
                        </div>
                    </div>
                </div>

                {/* === TWO-COLUMN: Funnel + Revenue/Observations === */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                    {/* Funnel por Etapa */}
                    <div className="lg:col-span-3 bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Distribuição por Etapa</h3>
                                <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-0.5">Leads criados em {formatDateBR(selectedDate)}</p>
                            </div>
                            <span className="text-[11px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg">
                                {data?.ativacoes ?? 0} total
                            </span>
                        </div>
                        {data && data.funnel.some(f => f.count > 0) ? (
                            <div className="space-y-3.5">
                                {data.funnel.map((stage, idx) => {
                                    const color = STAGE_COLORS[idx % STAGE_COLORS.length];
                                    return (
                                        <div key={idx}>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                                                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{stage.stage}</span>
                                                </div>
                                                <span className="text-xs font-bold text-slate-900 dark:text-white">{stage.count}</span>
                                            </div>
                                            <ProgressBar value={stage.count} max={maxFunnel} color={color} />
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50 flex items-center justify-center mb-3">
                                    <i className="fas fa-filter text-lg text-slate-400 dark:text-slate-600"></i>
                                </div>
                                <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">Nenhum lead nesta data</p>
                                <p className="text-xs text-slate-400 dark:text-slate-600 max-w-[240px]">Selecione outra data ou adicione leads ao pipeline.</p>
                            </div>
                        )}
                    </div>

                    {/* Right column: Revenue + Observations */}
                    <div className="lg:col-span-2 space-y-5">
                        {/* Receita do Dia */}
                        <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Receita do Dia</span>
                                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                    <i className="fas fa-dollar-sign text-emerald-500 text-xs"></i>
                                </div>
                            </div>
                            <p className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                R$ {(data?.receita_dia ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">Orçamentos aprovados</p>
                        </div>

                        {/* Resumo Rápido */}
                        <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Resumo Rápido</h4>
                            <div className="space-y-3">
                                {[
                                    { label: 'Ativações', value: data?.ativacoes ?? 0, icon: 'fa-user-plus', color: 'text-blue-500' },
                                    { label: 'Respostas', value: data?.respostas ?? 0, icon: 'fa-reply', color: 'text-purple-500' },
                                    { label: 'Follow-ups', value: data?.follows ?? 0, icon: 'fa-redo', color: 'text-amber-500' },
                                    { label: 'Conversões', value: data?.conversoes ?? 0, icon: 'fa-check-circle', color: 'text-emerald-500' },
                                ].map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/50 last:border-0">
                                        <div className="flex items-center gap-2.5">
                                            <i className={`fas ${item.icon} ${item.color} text-xs w-4 text-center`}></i>
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{item.label}</span>
                                        </div>
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Observações */}
                        <div className="bg-white dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                    <i className="far fa-sticky-note text-brand"></i> Observações do Dia
                                </h4>
                                {savingNotes && (
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                        <i className="fas fa-circle-notch fa-spin text-[8px]"></i> Salvando...
                                    </span>
                                )}
                                {notesSaved && !savingNotes && (
                                    <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                                        <i className="fas fa-check text-[8px]"></i> Salvo
                                    </span>
                                )}
                            </div>
                            <textarea
                                value={observations}
                                onChange={(e) => handleObservationsChange(e.target.value)}
                                placeholder="Anote aqui observações sobre o dia, metas alcançadas, pontos de atenção..."
                                rows={4}
                                className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-600 resize-none transition"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
