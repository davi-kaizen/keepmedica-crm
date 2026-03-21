'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import { useNotification } from '@/components/NotificationProvider';
import type { Lead, Stage } from '@/types';

type IgStep = 'login' | 'loading' | 'challenge' | 'success' | 'threads' | 'importing' | 'done' | 'import_session' | 'export_session';
type IgThread = {
    thread_id: string;
    user_id: string;
    username: string;
    full_name: string;
    profile_pic: string;
    last_message: string;
};
type ChatMessage = {
    id: string;
    text: string;
    from_me: boolean;
    timestamp: string;
    item_type: string;
    media_url: string;
    story_url: string;
    story_text: string;
};

// Memoized lead card: only re-renders if lead data actually changed
const GHOST_STAGES = ['NOVOS', 'QUALIFICACAO', 'PROPOSTA'];
const GHOST_HOURS = 48;

function isGhosting(lead: Lead): { ghosting: boolean; hours: number } {
    if (!lead.last_interaction || !GHOST_STAGES.includes(lead.status?.toUpperCase())) return { ghosting: false, hours: 0 };
    const last = new Date(lead.last_interaction).getTime();
    if (isNaN(last)) return { ghosting: false, hours: 0 };
    const hours = Math.floor((Date.now() - last) / 3600000);
    return { ghosting: hours >= GHOST_HOURS, hours };
}

const LeadCard = memo(function LeadCard({ lead, onOpenChat, onEdit, onDelete, showMenu, onToggleMenu }: {
    lead: Lead;
    onOpenChat: (lead: Lead) => void;
    onEdit: (lead: Lead) => void;
    onDelete: (id: number) => void;
    showMenu: boolean;
    onToggleMenu: (id: number | null) => void;
}) {
    const ghost = isGhosting(lead);
    return (
        <div
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(lead.id)); }}
            onClick={() => onOpenChat(lead)}
            className={`bg-white dark:bg-slate-800 border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-md dark:hover:shadow-lg transition-all group relative shadow-sm ${ghost.ghosting ? 'border-red-400/70 dark:border-red-500/50 shadow-red-100 dark:shadow-red-900/20' : 'border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600'}`}
        >
            <button
                onClick={(e) => { e.stopPropagation(); onToggleMenu(showMenu ? null : lead.id); }}
                className="absolute top-2 right-2 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-white opacity-0 group-hover:opacity-100 transition cursor-pointer"
            >
                <i className="fas fa-ellipsis-v text-xs"></i>
            </button>
            {showMenu && (
                <div className="absolute top-8 right-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden min-w-[120px]" onClick={e => e.stopPropagation()}>
                    <div
                        className="flex items-center gap-2 px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 cursor-pointer transition-colors"
                        onClick={() => { onEdit(lead); onToggleMenu(null); }}
                    >
                        <i className="far fa-edit"></i> Editar
                    </div>
                    <div
                        className="flex items-center gap-2 px-4 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer transition-colors"
                        onClick={() => onDelete(lead.id)}
                    >
                        <i className="far fa-trash-alt"></i> Excluir
                    </div>
                </div>
            )}

            {/* Ghosting indicator */}
            {ghost.ghosting && (
                <div className="absolute top-2 left-2 group/ghost" title={`Sem resposta há ${ghost.hours >= 24 ? Math.floor(ghost.hours / 24) + 'd' : ghost.hours + 'h'}. Envie um follow-up!`}>
                    <span className="relative flex h-5 w-5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-40"></span>
                        <span className="relative inline-flex rounded-full h-5 w-5 bg-red-100 dark:bg-red-900/60 items-center justify-center text-[10px]">⏰</span>
                    </span>
                </div>
            )}

            <div className="flex items-center gap-3 mb-2">
                {lead.profile_pic ? (
                    <img src={lead.profile_pic} alt={lead.name} className="w-9 h-9 rounded-full shrink-0" />
                ) : (
                    <div className="w-9 h-9 rounded-full bg-brand/15 flex items-center justify-center text-brand font-bold text-sm shrink-0">
                        {lead.name.charAt(0).toUpperCase()}
                    </div>
                )}
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{lead.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-500">@{lead.username}</p>
                </div>
            </div>

            {lead.last_msg && (
                <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2 mb-2 line-clamp-2 border border-slate-100 dark:border-transparent flex items-center gap-1.5">
                    {lead.last_msg.includes('[Áudio]') || lead.last_msg.includes('[audio]') ? (
                        <><i className="fas fa-microphone text-orange-500 text-[10px] shrink-0"></i><span>{lead.last_msg.replace('[Áudio]', 'Áudio').replace('[audio]', 'Áudio')}</span></>
                    ) : lead.last_msg.includes('[Foto]') || lead.last_msg.includes('[media]') ? (
                        <><i className="fas fa-camera text-blue-500 text-[10px] shrink-0"></i><span>{lead.last_msg.replace('[Foto]', 'Foto').replace('[media]', 'Mídia')}</span></>
                    ) : lead.last_msg.includes('[Vídeo]') ? (
                        <><i className="fas fa-video text-purple-500 text-[10px] shrink-0"></i><span>{lead.last_msg.replace('[Vídeo]', 'Vídeo')}</span></>
                    ) : lead.last_msg.includes('[GIF]') ? (
                        <><i className="fas fa-image text-pink-500 text-[10px] shrink-0"></i><span>GIF</span></>
                    ) : lead.last_msg.includes('[Reels]') ? (
                        <><i className="fas fa-film text-pink-500 text-[10px] shrink-0"></i><span>Reels</span></>
                    ) : (
                        <span>{lead.last_msg}</span>
                    )}
                </p>
            )}

            <div className="flex items-center justify-end mt-1">
                {lead.unread_count > 0 && (
                    <span className="bg-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                        {lead.unread_count}
                    </span>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    // Only re-render if these fields changed
    return prev.lead.id === next.lead.id
        && prev.lead.last_msg === next.lead.last_msg
        && prev.lead.unread_count === next.lead.unread_count
        && prev.lead.name === next.lead.name
        && prev.lead.status === next.lead.status
        && prev.lead.value === next.lead.value
        && prev.showMenu === next.showMenu;
});

export default function LeadsPage() {
    const searchParams = useSearchParams();
    const [stages, setStages] = useState<Stage[]>([]);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [dragOverStage, setDragOverStage] = useState<string | null>(null);
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    const [showCardMenu, setShowCardMenu] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showNewLeadModal, setShowNewLeadModal] = useState(false);
    const [newLead, setNewLead] = useState({ name: '', username: '', value: '' });
    const [editLead, setEditLead] = useState<{ name: string; value: string } | null>(null);
    const [showNewStageModal, setShowNewStageModal] = useState(false);
    const [newStageName, setNewStageName] = useState('');

    // Column management state
    const [stageMenuOpen, setStageMenuOpen] = useState<number | null>(null);
    const [editingStage, setEditingStage] = useState<{ id: number; name: string } | null>(null);
    const [confirmDeleteStage, setConfirmDeleteStage] = useState<Stage | null>(null);
    const stageMenuRef = useRef<HTMLDivElement>(null);

    // Instagram state
    const [showIgModal, setShowIgModal] = useState(false);
    const [igStep, setIgStep] = useState<IgStep>('login');
    const [igUsername, setIgUsername] = useState('');
    const [igPassword, setIgPassword] = useState('');
    const [igCode, setIgCode] = useState('');
    const [igError, setIgError] = useState('');
    const [igConnected, setIgConnected] = useState(false);
    const [igConnectedUser, setIgConnectedUser] = useState('');
    const [igChallengeMsg, setIgChallengeMsg] = useState('');
    const [igThreads, setIgThreads] = useState<IgThread[]>([]);
    const [igSelectedThreads, setIgSelectedThreads] = useState<Set<string>>(new Set());
    const [igImportResult, setIgImportResult] = useState('');
    const [igSessionToken, setIgSessionToken] = useState('');
    const [igThreadsLoading, setIgThreadsLoading] = useState(false);

    // Chat state
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatSending, setChatSending] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const chatPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Attachment HUD state
    const [showAttachHud, setShowAttachHud] = useState(false);
    const attachFileRef = useRef<HTMLInputElement>(null);
    const [attachType, setAttachType] = useState<'photo' | 'video' | 'audio'>('photo');

    // Quick replies state
    const [quickReplies, setQuickReplies] = useState<{ id: number; title: string; content: string }[]>([]);
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [showQuickReplyManager, setShowQuickReplyManager] = useState(false);
    const [newReplyTitle, setNewReplyTitle] = useState('');
    const [newReplyContent, setNewReplyContent] = useState('');

    // Chat header menu
    const [showChatMenu, setShowChatMenu] = useState(false);
    const chatMenuRef = useRef<HTMLDivElement>(null);
    const chatBodyRef = useRef<HTMLDivElement>(null);

    // Mic recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Kanban polling
    const kanbanPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastKnownLeadsRef = useRef<string>('');
    const selectedLeadNameRef = useRef<string>('');

    // Notification
    const { triggerNotification } = useNotification();

    // Close menus on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (stageMenuRef.current && !stageMenuRef.current.contains(e.target as Node)) {
                setStageMenuOpen(null);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Check Instagram connection on mount
    useEffect(() => {
        fetchApi('/instagram/status')
            .then(data => {
                if (data.connected) {
                    setIgConnected(true);
                    setIgConnectedUser(data.ig_username || '');
                }
            })
            .catch(() => {});
    }, []);

    const loadKanbanData = () => {
        fetchApi('/kanban/data')
            .then(data => {
                if (data && !data.error) {
                    setStages(data.stages || []);
                    setLeads(data.leads || []);
                }
            })
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    };

    useEffect(() => { loadKanbanData(); }, []);

    // Abrir chat automaticamente via query param ?openChat=<lead_id>
    const openChatParam = searchParams.get('openChat');
    useEffect(() => {
        if (openChatParam && leads.length > 0 && !selectedLead) {
            const leadId = parseInt(openChatParam, 10);
            const lead = leads.find(l => l.id === leadId);
            if (lead) {
                openChat(lead);
                // Limpar query param da URL sem recarregar
                window.history.replaceState({}, '', '/leads');
            }
        }
    }, [openChatParam, leads]);

    // Kanban polling: refresh leads every 5s to update card previews (last_msg, unread_count)
    const leadsRef = useRef<Lead[]>([]);
    useEffect(() => { leadsRef.current = leads; }, [leads]);
    useEffect(() => { selectedLeadNameRef.current = selectedLead?.name || ''; }, [selectedLead?.name]);

    useEffect(() => {
        kanbanPollingRef.current = setInterval(async () => {
            try {
                // Sincronizar last_msg do Instagram antes de buscar dados
                const syncRes = await fetchApi('/kanban/sync_messages', { method: 'POST' }).catch(() => null);
                if (syncRes?.status === 'reauthentication_required') {
                    setIgConnected(false);
                    setIgConnectedUser('');
                }
                const data = await fetchApi('/kanban/data');
                if (data && !data.error) {
                    const newLeads: Lead[] = data.leads || [];
                    const newHash = JSON.stringify(newLeads.map(l => ({ id: l.id, lm: l.last_msg, uc: l.unread_count, st: l.status })));

                    if (newHash !== lastKnownLeadsRef.current) {
                        // Check if any lead got a new incoming message
                        if (lastKnownLeadsRef.current) {
                            const oldLeads = leadsRef.current;
                            for (const nl of newLeads) {
                                const ol = oldLeads.find(o => o.id === nl.id);
                                if (ol && nl.unread_count > (ol.unread_count || 0)) {
                                    triggerNotification(nl.name);
                                    break;
                                }
                            }
                        }
                        lastKnownLeadsRef.current = newHash;
                        setLeads(newLeads);
                        if (data.stages) setStages(data.stages);
                    }
                }
            } catch { /* silent */ }
        }, 5000);

        return () => {
            if (kanbanPollingRef.current) {
                clearInterval(kanbanPollingRef.current);
                kanbanPollingRef.current = null;
            }
        };
    }, [triggerNotification]);

    const handleDragOver = (e: React.DragEvent, stageName: string) => {
        e.preventDefault();
        setDragOverStage(stageName);
    };

    const handleDragLeave = () => {
        setDragOverStage(null);
    };

    const handleDrop = async (e: React.DragEvent, stageName: string) => {
        const leadId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const lead = leads.find(l => l.id === leadId);
        if (lead && lead.status !== stageName) {
            setLeads(prev => prev.map(l =>
                l.id === leadId ? { ...l, status: stageName } : l
            ));
            try {
                await fetchApi('/update_stage', {
                    method: 'POST',
                    body: JSON.stringify({ id: leadId, status: stageName })
                });
            } catch (err) {
                console.error(err);
            }
        }
        setDragOverStage(null);
    };

    const handleDeleteLead = async (id: number) => {
        if (!confirm('Deseja realmente excluir este lead?')) return;
        setLeads(prev => prev.filter(l => l.id !== id));
        setShowCardMenu(null);
        try {
            await fetchApi('/delete_lead', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const handleCreateLead = async () => {
        if (!newLead.name.trim()) return;
        try {
            const res = await fetchApi('/leads/create', {
                method: 'POST',
                body: JSON.stringify({
                    name: newLead.name,
                    username: newLead.username || newLead.name.toLowerCase().replace(/\s/g, '_'),
                    value: parseFloat(newLead.value) || 0
                })
            });
            if (res.success) {
                const data = await fetchApi('/kanban/data');
                if (data && !data.error) {
                    setLeads(data.leads || []);
                }
                setNewLead({ name: '', username: '', value: '' });
                setShowNewLeadModal(false);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleEditLead = async () => {
        if (!selectedLead || !editLead) return;
        const updated = {
            id: selectedLead.id,
            name: editLead.name,
            value: parseFloat(editLead.value) || 0
        };
        setLeads(prev => prev.map(l =>
            l.id === selectedLead.id ? { ...l, name: updated.name, value: updated.value } : l
        ));
        setSelectedLead(prev => prev ? { ...prev, name: updated.name, value: updated.value } : null);
        setEditLead(null);
        try {
            await fetchApi('/lead/update_details', {
                method: 'POST',
                body: JSON.stringify(updated)
            });
        } catch (err) {
            console.error(err);
        }
    };

    const getLeadsForStage = (stageName: string) =>
        leads.filter(l => l.status === stageName);

    const getTotalValue = (stageName: string) =>
        getLeadsForStage(stageName).reduce((sum, l) => sum + (l.value || 0), 0);

    const STAGE_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#eab308', '#06b6d4', '#ef4444'];

    // --- Instagram handlers ---
    const openIgModal = () => {
        if (igConnected) {
            setIgStep('success');
            setIgError('');
            setIgSelectedThreads(new Set());
            setShowIgModal(true);
        } else {
            setIgStep('login');
            setIgUsername('');
            setIgPassword('');
            setIgCode('');
            setIgError('');
            setShowIgModal(true);
        }
    };

    const handleIgOAuth = async () => {
        setIgError('');
        setIgStep('loading');

        try {
            // Pegar URL de OAuth do backend
            const res = await fetchApi('/instagram/oauth/url');
            if (!res.url) { setIgError('Erro ao gerar URL.'); setIgStep('login'); return; }

            // Abrir popup com o login da Meta/Instagram
            const w = 600, h = 750;
            const left = window.screenX + (window.outerWidth - w) / 2;
            const top = window.screenY + (window.outerHeight - h) / 2;
            const popup = window.open(res.url, 'instagram_oauth', `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`);

            // Escutar resultado do popup via postMessage
            const handleMessage = (event: MessageEvent) => {
                if (event.data?.type === 'instagram_oauth') {
                    window.removeEventListener('message', handleMessage);
                    if (event.data.status === 'success') {
                        setIgConnected(true);
                        setIgConnectedUser(event.data.message || 'Instagram Business');
                        setIgStep('success');
                    } else {
                        setIgError(event.data.message || 'Erro na autorizacao.');
                        setIgStep('login');
                    }
                }
            };
            window.addEventListener('message', handleMessage);

            // Detectar se popup foi fechado sem completar
            const checkClosed = setInterval(() => {
                if (popup && popup.closed) {
                    clearInterval(checkClosed);
                    setTimeout(() => {
                        window.removeEventListener('message', handleMessage);
                        setIgStep(prev => prev === 'loading' ? 'login' : prev);
                    }, 1000);
                }
            }, 500);
        } catch { setIgError('Erro de conexao com o servidor.'); setIgStep('login'); }
    };

    const fetchIgThreads = async () => {
        setIgStep('threads');
        setIgThreads([]);
        setIgError('');
        setIgThreadsLoading(true);
        try {
            // Add timeout of 30 seconds
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const res = await fetchApi('/chat/threads', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.success) {
                setIgError(res.error || 'Erro ao buscar conversas.');
                setIgThreadsLoading(false);
                return;
            }
            const threads = (res.threads || []).map((t: Record<string, unknown>) => ({
                thread_id: t.thread_id as string,
                user_id: (t.user_id || '') as string,
                username: (t.username || t.user || '') as string,
                full_name: (t.full_name || t.user || '') as string,
                profile_pic: (t.profile_pic || '') as string,
                last_message: (t.last_message || t.last_msg || '') as string,
            }));
            setIgThreads(threads);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                setIgError('Tempo esgotado ao buscar conversas. Tente novamente.');
            } else {
                setIgError('Erro de conexao com o servidor. Verifique se o backend esta rodando.');
            }
        } finally {
            setIgThreadsLoading(false);
        }
    };

    const toggleThreadSelection = (threadId: string) => {
        setIgSelectedThreads(prev => {
            const next = new Set(prev);
            if (next.has(threadId)) next.delete(threadId);
            else next.add(threadId);
            return next;
        });
    };

    const toggleAllThreads = () => {
        if (igSelectedThreads.size === igThreads.length) {
            setIgSelectedThreads(new Set());
        } else {
            setIgSelectedThreads(new Set(igThreads.map(t => t.thread_id)));
        }
    };

    const handleIgImport = async () => {
        const selected = igThreads.filter(t => igSelectedThreads.has(t.thread_id));
        if (selected.length === 0) { setIgError('Selecione ao menos uma conversa.'); return; }
        setIgError('');
        setIgStep('importing');
        try {
            const res = await fetchApi('/instagram/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threads: selected }),
            });
            if (!res.success) { setIgError(res.error || 'Erro na importação.'); setIgStep('threads'); return; }
            setIgImportResult(res.message || `${res.imported} lead(s) importado(s).`);
            setIgStep('done');
            // Refresh Kanban data
            loadKanbanData();
        } catch { setIgError('Erro de conexão com o servidor.'); setIgStep('threads'); }
    };

    const handleIgDisconnect = async () => {
        try { await fetchApi('/instagram/disconnect', { method: 'POST' }); } catch { /* silent */ }
        setIgConnected(false);
        setIgConnectedUser('');
        setShowIgModal(false);
        setIgStep('login');
    };

    // --- Chat handlers ---
    const openChat = (lead: Lead) => {
        setSelectedLead(lead);
        setEditLead(null);
        setChatMessages([]);
        setChatInput('');
        setShowAttachHud(false);
        setShowQuickReplies(false);
        setShowChatMenu(false);
        if (lead.thread_id) {
            fetchChatMessages(lead.thread_id, true);
        }
        // Limpar unread_count ao abrir o chat
        if (lead.unread_count > 0) {
            setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, unread_count: 0 } : l));
            fetchApi('/notifications/clear', {
                method: 'POST',
                body: JSON.stringify({ id: lead.id }),
            }).catch(() => {});
        }
    };

    const isAtChatBottom = useCallback(() => {
        const el = chatBodyRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);

    const fetchChatMessages = useCallback(async (threadId: string, isInitial = false) => {
        if (isInitial) setChatLoading(true);
        try {
            const res = await fetchApi(`/instagram/messages/${threadId}`);
            if (res.status === 'reauthentication_required') {
                setIgConnected(false);
                setIgConnectedUser('');
                if (isInitial) {
                    setChatLoading(false);
                    alert('Sua conexão com o Instagram expirou. Por favor, faça o login novamente.');
                }
                return;
            }
            if (res.success) {
                const newMsgs: ChatMessage[] = res.messages || [];
                const wasAtBottom = isAtChatBottom();

                setChatMessages(prev => {
                    if (!isInitial && prev.length > 0 && newMsgs.length > 0) {
                        const lastPrevReal = [...prev].reverse().find(m => !m.id.startsWith('temp-'));
                        const lastNew = newMsgs[newMsgs.length - 1];
                        if (lastPrevReal && lastNew && lastPrevReal.id === lastNew.id) {
                            return prev;
                        }
                        // Nova mensagem chegou - verificar se é do lead (não nossa)
                        if (!isInitial && lastNew && !lastNew.from_me) {
                            triggerNotification(selectedLeadNameRef.current);
                        }
                    }
                    return newMsgs;
                });

                // Auto-scroll: sempre no inicial, apenas se já estava no final durante polling
                if (isInitial || wasAtBottom) {
                    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                }
            }
        } catch { /* silent */ }
        if (isInitial) setChatLoading(false);
    }, [isAtChatBottom, triggerNotification]);

    // Polling: buscar mensagens a cada 5s quando o chat está aberto
    useEffect(() => {
        if (selectedLead?.thread_id && !editLead) {
            chatPollingRef.current = setInterval(() => {
                fetchChatMessages(selectedLead.thread_id!, false);
            }, 5000);
        }
        return () => {
            if (chatPollingRef.current) {
                clearInterval(chatPollingRef.current);
                chatPollingRef.current = null;
            }
        };
    }, [selectedLead?.thread_id, editLead, fetchChatMessages]);

    // Fechar menus do chat ao clicar fora
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) setShowChatMenu(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Carregar quick replies ao montar
    useEffect(() => {
        fetchApi('/quick_replies')
            .then(data => { if (data.success) setQuickReplies(data.replies || []); })
            .catch(() => {});
    }, []);

    const handleSendMessage = async () => {
        if (!chatInput.trim() || !selectedLead?.thread_id || chatSending) return;
        const text = chatInput.trim();
        setChatInput('');
        setChatSending(true);
        setShowQuickReplies(false);

        // UI otimista
        const optimisticMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            text,
            from_me: true,
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            item_type: 'text',
            media_url: '',
            story_url: '',
            story_text: '',
        };
        setChatMessages(prev => [...prev, optimisticMsg]);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

        try {
            const sendRes = await fetchApi('/instagram/send_message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: selectedLead.thread_id, text }),
            });
            if (sendRes?.status === 'reauthentication_required') {
                setIgConnected(false);
                setIgConnectedUser('');
                alert('Sessão do Instagram expirou. Conecte novamente.');
            }
        } catch { /* mensagem já está na tela */ }
        setChatSending(false);
        chatInputRef.current?.focus();
    };

    // Attachment handlers
    const openFilePicker = (type: 'photo' | 'video' | 'audio') => {
        setAttachType(type);
        setShowAttachHud(false);
        setTimeout(() => attachFileRef.current?.click(), 100);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedLead?.thread_id) return;

        setChatSending(true);
        const optimisticMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            text: attachType === 'photo' ? '[Foto]' : attachType === 'video' ? '[Vídeo]' : '[Áudio]',
            from_me: true,
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            item_type: 'media',
            media_url: URL.createObjectURL(file),
            story_url: '',
            story_text: '',
        };
        setChatMessages(prev => [...prev, optimisticMsg]);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

        try {
            const formData = new FormData();
            formData.append('thread_id', selectedLead.thread_id);
            formData.append('media_type', attachType);
            formData.append('file', file);
            await fetchApi('/instagram/send_media', { method: 'POST', body: formData });
        } catch { /* já está na tela */ }
        setChatSending(false);
        if (attachFileRef.current) attachFileRef.current.value = '';
    };

    // Quick reply handlers
    const handleCreateQuickReply = async () => {
        if (!newReplyTitle.trim() || !newReplyContent.trim()) return;
        try {
            const res = await fetchApi('/quick_replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newReplyTitle.trim(), content: newReplyContent.trim() }),
            });
            if (res.success) {
                setQuickReplies(prev => [{ id: res.id, title: newReplyTitle.trim(), content: newReplyContent.trim() }, ...prev]);
                setNewReplyTitle('');
                setNewReplyContent('');
            }
        } catch { /* silent */ }
    };

    const handleDeleteQuickReply = async (id: number) => {
        setQuickReplies(prev => prev.filter(r => r.id !== id));
        try { await fetchApi(`/quick_replies/${id}`, { method: 'DELETE' }); } catch { /* silent */ }
    };

    const insertQuickReply = (content: string) => {
        setChatInput(content);
        setShowQuickReplies(false);
        chatInputRef.current?.focus();
    };

    // Mic recording handlers
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Tentar mp4 primeiro (Instagram aceita nativamente), fallback para webm
            let mimeType = 'audio/webm';
            let fileExt = '.webm';
            if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
                fileExt = '.mp4';
            } else if (MediaRecorder.isTypeSupported('audio/aac')) {
                mimeType = 'audio/aac';
                fileExt = '.aac';
            }

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
                setRecordingTime(0);

                const blob = new Blob(audioChunksRef.current, { type: mimeType });
                if (blob.size < 500 || !selectedLead?.thread_id) return; // too short

                setChatSending(true);
                const optimisticMsg: ChatMessage = {
                    id: `temp-${Date.now()}`,
                    text: '[Áudio]',
                    from_me: true,
                    timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    item_type: 'voice_media',
                    media_url: URL.createObjectURL(blob),
                    story_url: '',
                    story_text: '',
                };
                setChatMessages(prev => [...prev, optimisticMsg]);
                setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

                try {
                    const formData = new FormData();
                    formData.append('thread_id', selectedLead.thread_id!);
                    formData.append('media_type', 'audio');
                    formData.append('file', blob, `audio${fileExt}`);
                    await fetchApi('/instagram/send_media', { method: 'POST', body: formData });
                } catch { /* already on screen */ }
                setChatSending(false);
            };

            mediaRecorder.start();
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
            setRecordingTime(0);
            recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
        } catch {
            alert('Permissão de microfone negada. Habilite nas configurações do navegador.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
        }
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        audioChunksRef.current = [];
        setIsRecording(false);
        setRecordingTime(0);
    };

    // Cleanup recording timer on unmount
    useEffect(() => {
        return () => {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        };
    }, []);

    const handleAddStage = () => {
        if (!newStageName.trim()) return;
        if (stages.some(s => s.name.toLowerCase() === newStageName.trim().toLowerCase())) return;
        const newStage: Stage = {
            id: Date.now(),
            name: newStageName.trim(),
            color: STAGE_COLORS[stages.length % STAGE_COLORS.length],
            position: stages.length + 1,
            pipeline_id: stages[0]?.pipeline_id || 1,
        };
        setStages(prev => [...prev, newStage]);
        setNewStageName('');
        setShowNewStageModal(false);
    };

    // Column management handlers
    const handleRenameStage = () => {
        if (!editingStage || !editingStage.name.trim()) return;
        const oldStage = stages.find(s => s.id === editingStage.id);
        if (!oldStage) return;
        const oldName = oldStage.name;
        const newName = editingStage.name.trim();
        setStages(prev => prev.map(s => s.id === editingStage.id ? { ...s, name: newName } : s));
        setLeads(prev => prev.map(l => l.status === oldName ? { ...l, status: newName } : l));
        setEditingStage(null);
    };

    const handleDeleteStage = () => {
        if (!confirmDeleteStage) return;
        setStages(prev => prev.filter(s => s.id !== confirmDeleteStage.id));
        setLeads(prev => prev.filter(l => l.status !== confirmDeleteStage.name));
        setConfirmDeleteStage(null);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-[#0A0A0A]">
            {/* Kanban Header */}
            <div className="p-4 shrink-0 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A0A0A]">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                        <i className="fas fa-columns text-brand mr-2"></i>Pipeline de Leads
                    </h2>
                    <span className="text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full font-medium">
                        {leads.length} leads
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={openIgModal}
                        className={`px-4 py-2 rounded-xl text-sm font-bold shadow transition transform active:scale-95 flex items-center gap-2 cursor-pointer ${
                            igConnected
                                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:opacity-90'
                                : 'bg-gradient-to-r from-pink-600 to-orange-500 text-white hover:opacity-90'
                        }`}
                    >
                        <i className="fab fa-instagram text-base"></i>
                        <span className="hidden sm:inline">{igConnected ? 'Instagram Conectado' : 'Conectar Instagram'}</span>
                    </button>
                    <button
                        onClick={() => setShowNewLeadModal(true)}
                        className="bg-brand hover:opacity-90 text-white px-4 py-2 rounded-xl text-sm font-bold shadow transition cursor-pointer flex items-center gap-2"
                    >
                        <i className="fas fa-plus"></i> Novo Lead
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                    <i className="fas fa-circle-notch fa-spin text-4xl text-brand"></i>
                </div>
            ) : stages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-4">
                        <i className="fas fa-columns text-2xl text-slate-400 dark:text-slate-600"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-1">Nenhum pipeline configurado</h3>
                    <p className="text-sm text-slate-500 max-w-sm">Configure as etapas do seu funil no painel administrativo para começar a gerenciar leads.</p>
                    <button
                        onClick={() => setShowNewStageModal(true)}
                        className="mt-4 bg-brand hover:opacity-90 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow transition cursor-pointer flex items-center gap-2"
                    >
                        <i className="fas fa-plus"></i> Criar Primeira Etapa
                    </button>
                </div>
            ) : (
                <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4 pt-4">
                    <div className="flex gap-4 h-full items-start">
                        {stages.map((stage) => (
                            <div
                                key={stage.id}
                                className={`flex-shrink-0 w-[300px] flex flex-col rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 shadow-sm dark:shadow-none transition-colors ${dragOverStage === stage.name ? '!border-brand !bg-brand/5 dark:!bg-brand/10' : ''}`}
                                onDragOver={(e) => handleDragOver(e, stage.name)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, stage.name)}
                            >
                                {/* Column Header */}
                                <div className="p-3 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.color }}></div>
                                            <span className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide truncate">{stage.name}</span>
                                            <span className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded-full font-medium shrink-0">
                                                {getLeadsForStage(stage.name).length}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <span className="text-[11px] text-slate-500 dark:text-slate-500 font-medium hidden sm:inline">
                                                R$ {getTotalValue(stage.name).toLocaleString('pt-BR')}
                                            </span>
                                            {/* Column kebab menu */}
                                            <div className="relative" ref={stageMenuOpen === stage.id ? stageMenuRef : null}>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setStageMenuOpen(stageMenuOpen === stage.id ? null : stage.id); }}
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                                                >
                                                    <i className="fas fa-ellipsis-v text-xs"></i>
                                                </button>
                                                {stageMenuOpen === stage.id && (
                                                    <div className="absolute top-8 right-0 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl z-50 overflow-hidden min-w-[170px] animate-fade-in-up">
                                                        <div
                                                            className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 cursor-pointer transition-colors"
                                                            onClick={() => {
                                                                setEditingStage({ id: stage.id, name: stage.name });
                                                                setStageMenuOpen(null);
                                                            }}
                                                        >
                                                            <i className="far fa-edit text-brand"></i> Editar Nome da Etapa
                                                        </div>
                                                        <div className="border-t border-slate-100 dark:border-slate-600"></div>
                                                        <div
                                                            className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer transition-colors"
                                                            onClick={() => {
                                                                setConfirmDeleteStage(stage);
                                                                setStageMenuOpen(null);
                                                            }}
                                                        >
                                                            <i className="far fa-trash-alt"></i> Remover Etapa
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Cards */}
                                <div className="flex-1 overflow-y-auto p-2 space-y-2 kanban-col scrollbar-hide">
                                    {getLeadsForStage(stage.name).length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-10 text-center">
                                            <i className="far fa-inbox text-2xl text-slate-300 dark:text-slate-600 mb-2"></i>
                                            <p className="text-xs text-slate-400 dark:text-slate-600">Nenhum lead nesta etapa</p>
                                        </div>
                                    )}
                                    {getLeadsForStage(stage.name).map((lead) => (
                                        <LeadCard
                                            key={lead.id}
                                            lead={lead}
                                            onOpenChat={openChat}
                                            onEdit={(l) => { openChat(l); setEditLead({ name: l.name, value: String(l.value || 0) }); }}
                                            onDelete={handleDeleteLead}
                                            showMenu={showCardMenu === lead.id}
                                            onToggleMenu={setShowCardMenu}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* + Nova Coluna */}
                        <div
                            onClick={() => setShowNewStageModal(true)}
                            className="flex-shrink-0 w-[280px] min-h-[200px] flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:border-slate-400 dark:hover:border-slate-600 hover:text-slate-600 dark:hover:text-slate-400 transition-all cursor-pointer group"
                        >
                            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-3 group-hover:border-brand/30 group-hover:bg-brand/5 transition-colors">
                                <i className="fas fa-plus text-lg"></i>
                            </div>
                            <span className="text-sm font-semibold">Nova Coluna</span>
                            <span className="text-[11px] mt-0.5">Adicionar etapa ao funil</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Lead Chat Modal */}
            {selectedLead && !editLead && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setSelectedLead(null)}>
                    <div className="bg-white dark:bg-[#0f0f0f] rounded-2xl w-[480px] h-[85vh] max-h-[700px] flex flex-col shadow-2xl animate-fade-in-up overflow-hidden border border-slate-200 dark:border-slate-700/50" onClick={e => e.stopPropagation()}>

                        {/* Chat Header */}
                        <div className="bg-slate-50 dark:bg-[#1a1a1a] px-4 py-3 flex items-center justify-between shrink-0 border-b border-slate-200 dark:border-slate-700/50">
                            <div className="flex items-center gap-3">
                                {selectedLead.profile_pic ? (
                                    <img src={selectedLead.profile_pic} alt={selectedLead.name} className="w-10 h-10 rounded-full object-cover ring-2 ring-pink-500/30" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center text-white font-bold text-sm ring-2 ring-pink-500/30">
                                        {selectedLead.name.charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <h4 className="text-slate-900 dark:text-white font-semibold text-sm truncate">{selectedLead.name}</h4>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs">@{selectedLead.username}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Chat menu (3 dots) */}
                                <div className="relative" ref={chatMenuRef}>
                                    <button
                                        onClick={() => setShowChatMenu(!showChatMenu)}
                                        className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                                    >
                                        <i className="fas fa-ellipsis-v text-xs"></i>
                                    </button>
                                    {showChatMenu && (
                                        <div className="absolute top-10 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden min-w-[200px] animate-fade-in-up">
                                            <div
                                                className="flex items-center gap-2.5 px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                                                onClick={() => { setEditLead({ name: selectedLead.name, value: String(selectedLead.value || 0) }); setShowChatMenu(false); }}
                                            >
                                                <i className="far fa-edit text-brand w-4"></i> Editar Lead
                                            </div>
                                            <div className="border-t border-slate-100 dark:border-slate-700"></div>
                                            <div
                                                className="flex items-center gap-2.5 px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                                                onClick={() => { setShowQuickReplyManager(true); setShowChatMenu(false); }}
                                            >
                                                <i className="fas fa-bolt text-amber-500 w-4"></i> Configurar Respostas Rápidas
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <button onClick={() => setSelectedLead(null)} className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer">
                                    <i className="fas fa-times text-sm"></i>
                                </button>
                            </div>
                        </div>

                        {/* Chat Body */}
                        <div ref={chatBodyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-white dark:bg-[#0f0f0f]" style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
                            {chatLoading ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-3">
                                    <div className="w-10 h-10 border-[3px] border-slate-200 dark:border-slate-600 border-t-pink-500 rounded-full animate-spin"></div>
                                    <p className="text-slate-400 dark:text-slate-500 text-xs">Carregando mensagens...</p>
                                </div>
                            ) : !selectedLead.thread_id ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-3 text-center px-8">
                                    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                        <i className="fas fa-comment-slash text-2xl text-slate-300 dark:text-slate-600"></i>
                                    </div>
                                    <p className="text-slate-500 text-sm">Este lead não possui conversa do Instagram vinculada.</p>
                                    <p className="text-slate-400 dark:text-slate-600 text-xs">Importe leads pelo Instagram para habilitar o chat.</p>
                                </div>
                            ) : chatMessages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-3">
                                    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                        <i className="fab fa-instagram text-2xl text-slate-300 dark:text-slate-600"></i>
                                    </div>
                                    <p className="text-slate-500 text-sm">Nenhuma mensagem nesta conversa.</p>
                                </div>
                            ) : (
                                <>
                                    {chatMessages.map((msg) => (
                                        <div key={msg.id} className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                                            <div className="max-w-[75%]">
                                                {/* Story reply preview */}
                                                {msg.story_url && (
                                                    <div className={`mb-1 ${msg.from_me ? 'ml-auto' : ''}`}>
                                                        <div className="bg-slate-100 dark:bg-slate-800/80 rounded-xl p-2 border border-slate-200 dark:border-slate-700/50 max-w-[200px]">
                                                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 font-medium">
                                                                <i className="fas fa-reply text-[8px] mr-1"></i>Respondeu ao story
                                                            </p>
                                                            <img src={msg.story_url} alt="Story" className="rounded-lg w-full max-h-[120px] object-cover" />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Audio player for voice messages */}
                                                {msg.item_type === 'voice_media' && msg.media_url && (
                                                    <div className={`mb-1 ${msg.from_me ? 'ml-auto' : ''}`}>
                                                        <div className={`rounded-2xl px-3 py-2 ${msg.from_me ? 'bg-[#3797f0]' : 'bg-slate-100 dark:bg-[#262626]'}`}>
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                <i className={`fas fa-microphone text-xs ${msg.from_me ? 'text-white/70' : 'text-orange-500'}`}></i>
                                                                <span className={`text-[11px] font-medium ${msg.from_me ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>Mensagem de voz</span>
                                                            </div>
                                                            <audio controls className="w-full max-w-[220px] h-8 [&::-webkit-media-controls-panel]:bg-transparent" style={{ filter: msg.from_me ? 'invert(1) brightness(2)' : undefined }}>
                                                                <source src={msg.media_url} />
                                                            </audio>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Media image (non-audio) */}
                                                {msg.media_url && msg.item_type !== 'voice_media' && (
                                                    <div className={`mb-1 rounded-2xl overflow-hidden ${msg.from_me ? 'ml-auto' : ''}`}>
                                                        <img src={msg.media_url} alt="Media" className="max-w-full max-h-[200px] rounded-2xl object-cover" />
                                                    </div>
                                                )}

                                                {/* Message bubble */}
                                                {msg.text && (
                                                    <div className={`px-3.5 py-2 rounded-2xl ${
                                                        msg.from_me
                                                            ? 'bg-[#3797f0] text-white rounded-br-md'
                                                            : 'bg-slate-100 dark:bg-[#262626] text-slate-900 dark:text-white rounded-bl-md'
                                                    }`}>
                                                        <p className="text-[13px] leading-relaxed break-words">{msg.text}</p>
                                                    </div>
                                                )}

                                                {/* Timestamp */}
                                                {msg.timestamp && (
                                                    <p className={`text-[10px] text-slate-400 dark:text-slate-600 mt-0.5 ${msg.from_me ? 'text-right' : 'text-left'}`}>
                                                        {msg.timestamp}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={chatEndRef} />
                                </>
                            )}
                        </div>

                        {/* Re-engage banner for ghosting leads */}
                        {selectedLead.thread_id && isGhosting(selectedLead).ghosting && !chatInput && (
                            <button
                                onClick={() => {
                                    const firstName = selectedLead.name.split(' ')[0];
                                    setChatInput(`Oi ${firstName}, notei que não conseguimos dar continuidade. Alguma dúvida sobre o procedimento? 😊`);
                                    chatInputRef.current?.focus();
                                }}
                                className="mx-3 mb-0 mt-2 flex items-center justify-center gap-2 py-2 px-4 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl text-xs font-semibold transition-all shadow-sm cursor-pointer"
                            >
                                <span>🚀</span> Re-engajar — Sem resposta há {isGhosting(selectedLead).hours >= 24 ? Math.floor(isGhosting(selectedLead).hours / 24) + ' dias' : isGhosting(selectedLead).hours + 'h'}
                            </button>
                        )}

                        {/* Chat Input Bar */}
                        {selectedLead.thread_id && (
                            <div className="bg-slate-50 dark:bg-[#1a1a1a] px-3 py-3 border-t border-slate-200 dark:border-slate-700/50 shrink-0 relative">
                                {/* Attachment HUD */}
                                {showAttachHud && (
                                    <div className="absolute bottom-full left-3 mb-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up min-w-[200px]">
                                        <div className="p-2 space-y-1">
                                            <button onClick={() => openFilePicker('photo')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer">
                                                <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center"><i className="fas fa-image text-blue-500 text-sm"></i></div>
                                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Fotos e vídeos</span>
                                            </button>
                                            <button onClick={() => openFilePicker('video')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer">
                                                <div className="w-9 h-9 rounded-full bg-purple-500/10 flex items-center justify-center"><i className="fas fa-file text-purple-500 text-sm"></i></div>
                                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Documento</span>
                                            </button>
                                            <button onClick={() => openFilePicker('audio')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer">
                                                <div className="w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center"><i className="fas fa-headphones text-orange-500 text-sm"></i></div>
                                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Áudio</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Quick Replies dropdown */}
                                {showQuickReplies && quickReplies.length > 0 && (
                                    <div className="absolute bottom-full left-3 right-3 mb-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up max-h-[200px] overflow-y-auto">
                                        <div className="p-1.5 space-y-0.5">
                                            {quickReplies.map(r => (
                                                <button key={r.id} onClick={() => insertQuickReply(r.content)}
                                                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer">
                                                    <p className="text-xs font-bold text-brand">{r.title}</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.content}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <input ref={attachFileRef} type="file" className="hidden"
                                    accept={attachType === 'photo' ? 'image/*,video/*' : attachType === 'audio' ? 'audio/*' : '*'}
                                    onChange={handleFileUpload} />

                                <div className="flex items-center gap-2">
                                    {/* Attach button */}
                                    <button
                                        onClick={() => { setShowAttachHud(!showAttachHud); setShowQuickReplies(false); }}
                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition cursor-pointer active:scale-95 shrink-0 ${
                                            showAttachHud
                                                ? 'bg-brand text-white'
                                                : 'bg-slate-100 dark:bg-[#262626] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        <i className={`fas ${showAttachHud ? 'fa-times' : 'fa-plus'} text-sm`}></i>
                                    </button>

                                    <div className="flex-1 flex items-center bg-slate-100 dark:bg-[#262626] rounded-full px-4 py-2.5 border border-slate-200 dark:border-slate-700/50 focus-within:border-brand dark:focus-within:border-slate-500 transition">
                                        {/* Quick reply bolt icon */}
                                        {quickReplies.length > 0 && (
                                            <button
                                                onClick={() => { setShowQuickReplies(!showQuickReplies); setShowAttachHud(false); }}
                                                className={`mr-2 transition cursor-pointer ${showQuickReplies ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`}
                                                title="Respostas Rápidas"
                                            >
                                                <i className="fas fa-bolt text-sm"></i>
                                            </button>
                                        )}
                                        <input
                                            ref={chatInputRef}
                                            type="text"
                                            value={chatInput}
                                            onChange={e => { setChatInput(e.target.value); setShowAttachHud(false); setShowQuickReplies(false); }}
                                            onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                                            placeholder="Mensagem..."
                                            className="flex-1 bg-transparent text-slate-900 dark:text-white text-sm outline-none placeholder-slate-400 dark:placeholder-slate-500"
                                            disabled={chatSending}
                                        />
                                    </div>
                                    {chatInput.trim() ? (
                                        <button
                                            onClick={handleSendMessage}
                                            disabled={chatSending}
                                            className="w-10 h-10 rounded-full bg-[#3797f0] text-white flex items-center justify-center hover:bg-[#2b86de] transition cursor-pointer active:scale-95 disabled:opacity-50 shrink-0"
                                        >
                                            <i className="fas fa-paper-plane text-sm"></i>
                                        </button>
                                    ) : isRecording ? (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={cancelRecording}
                                                className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center hover:text-red-500 transition cursor-pointer active:scale-95 shrink-0"
                                                title="Cancelar"
                                            >
                                                <i className="fas fa-trash text-xs"></i>
                                            </button>
                                            <span className="text-xs font-mono font-bold text-red-500 min-w-[35px] text-center tabular-nums">
                                                {Math.floor(recordingTime / 60).toString().padStart(1, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
                                            </span>
                                            <button
                                                onClick={stopRecording}
                                                className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition cursor-pointer active:scale-95 shrink-0 animate-pulse"
                                                title="Enviar áudio"
                                            >
                                                <i className="fas fa-stop text-sm"></i>
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={startRecording}
                                            className="w-10 h-10 rounded-full bg-slate-100 dark:bg-[#262626] text-slate-500 dark:text-slate-400 flex items-center justify-center hover:text-orange-500 dark:hover:text-orange-400 transition cursor-pointer shrink-0 active:scale-95"
                                            title="Gravar áudio"
                                        >
                                            <i className="fas fa-microphone text-sm"></i>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Quick Reply Manager Modal */}
            {showQuickReplyManager && (
                <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowQuickReplyManager(false)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[450px] max-h-[80vh] flex flex-col shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <i className="fas fa-bolt text-amber-500"></i> Respostas Rápidas
                            </h3>
                            <button onClick={() => setShowQuickReplyManager(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-xl cursor-pointer">&times;</button>
                        </div>

                        {/* Add new */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3 shrink-0">
                            <input
                                value={newReplyTitle} onChange={e => setNewReplyTitle(e.target.value)}
                                placeholder="Título (ex: Boas-vindas)"
                                className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400"
                            />
                            <textarea
                                value={newReplyContent} onChange={e => setNewReplyContent(e.target.value)}
                                placeholder="Conteúdo da mensagem..."
                                rows={3}
                                className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 resize-none"
                            />
                            <button
                                onClick={handleCreateQuickReply}
                                disabled={!newReplyTitle.trim() || !newReplyContent.trim()}
                                className="w-full bg-brand hover:opacity-90 text-white py-2.5 rounded-xl text-sm font-bold transition cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                <i className="fas fa-plus"></i> Adicionar Resposta
                            </button>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {quickReplies.length === 0 ? (
                                <p className="text-center text-slate-400 text-sm py-8">Nenhuma resposta rápida cadastrada.</p>
                            ) : quickReplies.map(r => (
                                <div key={r.id} className="flex items-start gap-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700/50 group">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-brand">{r.title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{r.content}</p>
                                    </div>
                                    <button onClick={() => handleDeleteQuickReply(r.id)}
                                        className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition cursor-pointer opacity-0 group-hover:opacity-100 shrink-0 mt-0.5">
                                        <i className="fas fa-trash-alt text-xs"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Lead Edit Modal */}
            {selectedLead && editLead && (
                <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center backdrop-blur-sm" onClick={() => setEditLead(null)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[450px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white"><i className="far fa-edit text-brand mr-2"></i>Editar Lead</h3>
                            <button onClick={() => setEditLead(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Nome</label>
                                <input value={editLead.name} onChange={e => setEditLead({ ...editLead, name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Valor (R$)</label>
                                <input type="number" value={editLead.value} onChange={e => setEditLead({ ...editLead, value: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand" />
                            </div>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button onClick={handleEditLead} className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer">Salvar</button>
                            <button onClick={() => setEditLead(null)} className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer">Cancelar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Lead Modal */}
            {showNewLeadModal && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowNewLeadModal(false)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[450px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white"><i className="fas fa-user-plus text-brand mr-2"></i>Novo Lead</h3>
                            <button onClick={() => setShowNewLeadModal(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Nome *</label>
                                <input
                                    value={newLead.name}
                                    onChange={e => setNewLead({ ...newLead, name: e.target.value })}
                                    placeholder="Nome do paciente ou contato"
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Username</label>
                                <input
                                    value={newLead.username}
                                    onChange={e => setNewLead({ ...newLead, username: e.target.value })}
                                    placeholder="@usuario (opcional)"
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Valor (R$)</label>
                                <input
                                    type="number"
                                    value={newLead.value}
                                    onChange={e => setNewLead({ ...newLead, value: e.target.value })}
                                    placeholder="0"
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500"
                                />
                            </div>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={handleCreateLead}
                                disabled={!newLead.name.trim()}
                                className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-50 shadow-lg shadow-brand/20"
                            >
                                <i className="fas fa-plus mr-2"></i>Adicionar Lead
                            </button>
                            <button
                                onClick={() => setShowNewLeadModal(false)}
                                className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Stage Modal */}
            {showNewStageModal && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowNewStageModal(false)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[420px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                                <i className="fas fa-columns text-brand mr-2"></i>Nova Etapa
                            </h3>
                            <button onClick={() => setShowNewStageModal(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6">
                            <label className="text-xs text-slate-500 mb-1 block font-bold">Nome da Etapa *</label>
                            <input
                                value={newStageName}
                                onChange={e => setNewStageName(e.target.value)}
                                placeholder="Ex: Em Negociação, Fechado..."
                                className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleAddStage()}
                            />
                            {stages.some(s => s.name.toLowerCase() === newStageName.trim().toLowerCase()) && newStageName.trim() && (
                                <p className="text-xs text-amber-500 mt-2 flex items-center gap-1">
                                    <i className="fas fa-exclamation-triangle"></i> Já existe uma etapa com este nome.
                                </p>
                            )}
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={handleAddStage}
                                disabled={!newStageName.trim() || stages.some(s => s.name.toLowerCase() === newStageName.trim().toLowerCase())}
                                className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-50 shadow-lg shadow-brand/20"
                            >
                                <i className="fas fa-plus mr-2"></i>Criar Etapa
                            </button>
                            <button
                                onClick={() => setShowNewStageModal(false)}
                                className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rename Stage Modal */}
            {editingStage && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setEditingStage(null)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[420px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                <i className="far fa-edit text-brand mr-2"></i>Renomear Etapa
                            </h3>
                            <button onClick={() => setEditingStage(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6">
                            <label className="text-xs text-slate-500 mb-1 block font-bold">Novo Nome *</label>
                            <input
                                value={editingStage.name}
                                onChange={e => setEditingStage({ ...editingStage, name: e.target.value })}
                                className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleRenameStage()}
                            />
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={handleRenameStage}
                                disabled={!editingStage.name.trim()}
                                className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-50"
                            >
                                <i className="fas fa-check mr-2"></i>Salvar
                            </button>
                            <button
                                onClick={() => setEditingStage(null)}
                                className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== INSTAGRAM MODAL ===== */}
            {showIgModal && (
                <>
                    <div
                        className="fixed inset-0 bg-black/50 z-[200] animate-fade-in"
                        onClick={() => { if (igStep !== 'loading' && igStep !== 'importing') setShowIgModal(false); }}
                    />
                    <div className="fixed inset-0 z-[201] flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in-up max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                            {/* Modal Header */}
                            <div className="bg-gradient-to-r from-pink-600 to-orange-500 px-6 py-5 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                        <i className="fab fa-instagram text-white text-xl"></i>
                                    </div>
                                    <div>
                                        <h3 className="text-white font-bold text-lg">Instagram</h3>
                                        <p className="text-white/70 text-xs">
                                            {igStep === 'threads' || igStep === 'done' ? 'Importar conversas para o Kanban' : 'Conectar conta ao CRM'}
                                        </p>
                                    </div>
                                </div>
                                {igStep !== 'loading' && igStep !== 'importing' && (
                                    <button onClick={() => setShowIgModal(false)} className="text-white/70 hover:text-white text-2xl cursor-pointer transition leading-none">&times;</button>
                                )}
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 overflow-y-auto flex-1">
                                {/* LOGIN - OAuth Meta */}
                                {igStep === 'login' && (
                                    <div className="space-y-5">
                                        <div className="text-center space-y-2">
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                Faca login diretamente com sua conta do Instagram.
                                            </p>
                                        </div>
                                        {igError && (
                                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-xl px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <i className="fas fa-exclamation-circle"></i>
                                                    <span className="font-semibold">Erro ao conectar</span>
                                                </div>
                                                <p className="mt-1 text-xs opacity-90">{igError}</p>
                                            </div>
                                        )}
                                        <button onClick={handleIgOAuth}
                                            className="w-full bg-[#0095f6] hover:bg-[#1877f2] text-white py-3.5 rounded-xl font-bold transition active:scale-[0.98] cursor-pointer shadow-lg flex items-center justify-center gap-3 text-base">
                                            <i className="fab fa-instagram text-lg"></i>
                                            Continuar com Instagram
                                        </button>
                                        <div className="flex items-center gap-3 px-2">
                                            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                                            <span className="text-xs text-slate-400">via Meta Business</span>
                                            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                                        </div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 text-center leading-relaxed">
                                            Voce sera redirecionado para o login oficial da Meta.
                                            <br />Conexao segura via API oficial. Zero risco de bloqueio.
                                        </p>
                                    </div>
                                )}

                                {/* LOADING */}
                                {igStep === 'loading' && (
                                    <div className="flex flex-col items-center justify-center py-10 space-y-4">
                                        <div className="w-14 h-14 border-4 border-pink-200 border-t-pink-600 rounded-full animate-spin"></div>
                                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Conectando ao Instagram...</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">Isso pode levar alguns segundos</p>
                                    </div>
                                )}

                                {/* CHALLENGE - mantido para compatibilidade mas nao usado com Graph API */}

                                {/* SUCCESS — connected, show import button */}
                                {igStep === 'success' && (
                                    <div className="flex flex-col items-center py-6 space-y-4">
                                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                            <i className="fas fa-check-circle text-green-500 text-3xl"></i>
                                        </div>
                                        <div className="text-center">
                                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">Conta Conectada!</h4>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1"><i className="fab fa-instagram mr-1"></i>{igConnectedUser ? `@${igConnectedUser}` : 'Instagram Business'}</p>
                                        </div>
                                        <div className="flex gap-3 w-full pt-2">
                                            <button onClick={() => { fetchIgThreads(); }}
                                                className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer shadow-lg shadow-brand/20 flex items-center justify-center gap-2">
                                                <i className="fas fa-download"></i> Importar Conversas
                                            </button>
                                            <button onClick={handleIgDisconnect}
                                                className="px-4 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 py-3 rounded-xl font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition cursor-pointer text-sm">
                                                <i className="fas fa-unlink"></i>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* THREADS LIST */}
                                {igStep === 'threads' && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                                Conversas recentes ({igThreads.length})
                                            </p>
                                            {igThreads.length > 0 && (
                                                <button onClick={toggleAllThreads}
                                                    className="text-xs text-brand hover:underline cursor-pointer font-medium">
                                                    {igSelectedThreads.size === igThreads.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                                                </button>
                                            )}
                                        </div>

                                        {igError && (
                                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-xl px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <i className="fas fa-exclamation-circle"></i>{igError}
                                                </div>
                                                <button onClick={fetchIgThreads} className="mt-2 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 underline cursor-pointer font-medium">
                                                    <i className="fas fa-redo mr-1"></i>Tentar novamente
                                                </button>
                                            </div>
                                        )}

                                        {igThreadsLoading ? (
                                            <div className="flex flex-col items-center py-10 space-y-3">
                                                <div className="w-12 h-12 border-4 border-slate-200 dark:border-slate-600 border-t-brand rounded-full animate-spin"></div>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">Buscando conversas...</p>
                                            </div>
                                        ) : igThreads.length === 0 && !igError ? (
                                            <div className="flex flex-col items-center py-8 space-y-4 text-center px-4">
                                                <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                                    <i className="fab fa-instagram text-blue-500 text-2xl"></i>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Instagram conectado com sucesso!</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed max-w-xs mx-auto">
                                                        As conversas aparecerao aqui quando alguem enviar uma mensagem no Instagram para <strong>@{igConnectedUser || 'sua conta'}</strong>.
                                                    </p>
                                                </div>
                                                <div className="bg-slate-100 dark:bg-slate-700/50 rounded-xl px-4 py-3 text-left w-full max-w-xs">
                                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Para testar agora:</p>
                                                    <ol className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 list-decimal list-inside">
                                                        <li>Abra outro celular ou conta do Instagram</li>
                                                        <li>Envie uma DM para @{igConnectedUser || 'sua conta'}</li>
                                                        <li>Volte aqui e clique em &quot;Atualizar&quot;</li>
                                                    </ol>
                                                </div>
                                                <button onClick={fetchIgThreads} className="text-sm text-brand hover:underline cursor-pointer font-medium mt-2">
                                                    <i className="fas fa-sync-alt mr-1"></i>Atualizar conversas
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5 max-h-[350px] overflow-y-auto pr-1">
                                                {igThreads.map(thread => (
                                                    <div
                                                        key={thread.thread_id}
                                                        onClick={() => toggleThreadSelection(thread.thread_id)}
                                                        className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${
                                                            igSelectedThreads.has(thread.thread_id)
                                                                ? 'bg-brand/5 dark:bg-brand/10 border-brand/30'
                                                                : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                        }`}
                                                    >
                                                        {/* Checkbox */}
                                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                                                            igSelectedThreads.has(thread.thread_id)
                                                                ? 'bg-brand border-brand text-white'
                                                                : 'border-slate-300 dark:border-slate-500'
                                                        }`}>
                                                            {igSelectedThreads.has(thread.thread_id) && <i className="fas fa-check text-[10px]"></i>}
                                                        </div>

                                                        {/* Avatar */}
                                                        {thread.profile_pic ? (
                                                            <img src={thread.profile_pic} alt={thread.username} className="w-10 h-10 rounded-full shrink-0 object-cover" />
                                                        ) : (
                                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                                                {thread.full_name.charAt(0).toUpperCase()}
                                                            </div>
                                                        )}

                                                        {/* Info */}
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{thread.full_name}</p>
                                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">@{thread.username}</p>
                                                            {thread.last_message && (
                                                                <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{thread.last_message}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {igThreads.length > 0 && (
                                            <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex gap-3">
                                                <button onClick={handleIgImport}
                                                    disabled={igSelectedThreads.size === 0}
                                                    className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-brand/20 flex items-center justify-center gap-2">
                                                    <i className="fas fa-file-import"></i>
                                                    Confirmar Importação ({igSelectedThreads.size})
                                                </button>
                                                <button onClick={handleIgExportSession}
                                                    className="px-5 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-600 py-3 rounded-xl font-bold transition cursor-pointer border border-emerald-200 dark:border-emerald-800 flex items-center gap-2"
                                                    title="Exportar sessão para usar na VPS">
                                                    <i className="fas fa-upload"></i>
                                                </button>
                                                <button onClick={handleIgDisconnect}
                                                    className="px-5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 py-3 rounded-xl font-bold transition cursor-pointer border border-red-200 dark:border-red-800 flex items-center gap-2">
                                                    <i className="fas fa-unlink"></i> Desconectar
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* IMPORTING */}
                                {igStep === 'importing' && (
                                    <div className="flex flex-col items-center justify-center py-10 space-y-4">
                                        <div className="w-14 h-14 border-4 border-brand/30 border-t-brand rounded-full animate-spin"></div>
                                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Importando leads para o Kanban...</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">{igSelectedThreads.size} conversa(s) selecionada(s)</p>
                                    </div>
                                )}

                                {/* DONE */}
                                {igStep === 'done' && (
                                    <div className="flex flex-col items-center py-6 space-y-4">
                                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                            <i className="fas fa-check-circle text-green-500 text-3xl"></i>
                                        </div>
                                        <div className="text-center">
                                            <h4 className="text-lg font-bold text-slate-900 dark:text-white">Importação Concluída!</h4>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{igImportResult}</p>
                                        </div>
                                        <div className="flex gap-3 w-full pt-2">
                                            <button onClick={() => setShowIgModal(false)}
                                                className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer shadow-lg shadow-brand/20">
                                                <i className="fas fa-columns mr-2"></i>Ver no Kanban
                                            </button>
                                            <button onClick={() => { setIgSelectedThreads(new Set()); fetchIgThreads(); }}
                                                className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 py-3 rounded-xl font-semibold hover:bg-slate-200 dark:hover:bg-slate-600 transition cursor-pointer">
                                                <i className="fas fa-redo mr-1"></i> Importar Mais
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Confirm Delete Stage Modal */}
            {confirmDeleteStage && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setConfirmDeleteStage(null)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[420px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 text-center">
                            <div className="w-14 h-14 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
                                <i className="fas fa-trash-alt text-xl text-red-500"></i>
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Remover Etapa</h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                Tem certeza que deseja remover a etapa <strong className="text-slate-900 dark:text-white">&ldquo;{confirmDeleteStage.name}&rdquo;</strong>?
                            </p>
                            <p className="text-xs text-red-500 font-medium">
                                {getLeadsForStage(confirmDeleteStage.name).length > 0
                                    ? `${getLeadsForStage(confirmDeleteStage.name).length} lead(s) nesta etapa serão removidos.`
                                    : 'Nenhum lead será afetado.'}
                            </p>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={handleDeleteStage}
                                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-bold transition cursor-pointer shadow-lg shadow-red-500/20"
                            >
                                <i className="fas fa-trash-alt mr-2"></i>Sim, Remover
                            </button>
                            <button
                                onClick={() => setConfirmDeleteStage(null)}
                                className="flex-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
