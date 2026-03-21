'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchApi } from '@/lib/api';

type Thread = {
    thread_id: string;
    user_id: string;
    user: { name: string; username: string; pic: string };
    last_msg: string;
    updated_time: string;
    lead_info?: { status: string; color: string } | null;
};

type Message = {
    id: string;
    text: string;
    is_sent_by_me: boolean;
    sender_name: string;
    created_time: string;
};

export default function ChatPage() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [messageInput, setMessageInput] = useState('');
    const [isLoadingThreads, setIsLoadingThreads] = useState(true);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => { scrollToBottom(); }, [messages]);

    // Carregar threads
    const loadThreads = useCallback(async () => {
        try {
            const data = await fetchApi('/chat/threads');
            if (data.success) {
                setThreads(data.threads || []);
                setError('');
            } else {
                setError(data.error || 'Erro ao carregar conversas');
            }
        } catch {
            setError('Erro de conexao com o servidor');
        } finally {
            setIsLoadingThreads(false);
        }
    }, []);

    // Carregar mensagens de um thread
    const loadMessages = useCallback(async (threadId: string) => {
        setIsLoadingMessages(true);
        try {
            const data = await fetchApi(`/chat/messages?thread_id=${threadId}`);
            if (data.success) {
                setMessages(data.messages || []);
            }
        } catch {
            console.error('Erro ao carregar mensagens');
        } finally {
            setIsLoadingMessages(false);
        }
    }, []);

    useEffect(() => {
        loadThreads();
        // Poll threads a cada 30s
        pollRef.current = setInterval(loadThreads, 30000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [loadThreads]);

    // Quando seleciona um thread, carregar mensagens
    useEffect(() => {
        if (selectedThread) {
            loadMessages(selectedThread.thread_id);
        }
    }, [selectedThread, loadMessages]);

    const filteredThreads = threads.filter(t =>
        t.user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.last_msg.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSelectThread = (thread: Thread) => {
        setSelectedThread(thread);
        setMessages([]);
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !selectedThread || isSending) return;

        const text = messageInput.trim();
        setMessageInput('');
        setIsSending(true);

        // Adicionar mensagem otimisticamente
        const optimistic: Message = {
            id: `temp-${Date.now()}`,
            text,
            is_sent_by_me: true,
            sender_name: 'Eu',
            created_time: new Date().toISOString()
        };
        setMessages(prev => [...prev, optimistic]);

        try {
            const data = await fetchApi('/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient_id: selectedThread.user_id,
                    text
                })
            });

            if (!data.success) {
                // Remover mensagem otimista se falhou
                setMessages(prev => prev.filter(m => m.id !== optimistic.id));
                alert(data.error || 'Erro ao enviar mensagem');
            }
        } catch {
            setMessages(prev => prev.filter(m => m.id !== optimistic.id));
            alert('Erro de conexao ao enviar mensagem');
        } finally {
            setIsSending(false);
        }
    };

    const formatTime = (iso: string) => {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
    };

    return (
        <div className="h-full flex bg-slate-50 dark:bg-[#0A0A0A]">
            {/* Sidebar - Thread List */}
            <div className="w-[380px] border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col shrink-0 z-10 transition-transform md:translate-x-0 hidden md:flex">
                {/* Header */}
                <div className="h-16 border-b border-slate-200 dark:border-slate-700 p-4 shrink-0 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white">
                            <i className="fab fa-instagram"></i>
                        </div>
                        <h2 className="font-bold text-slate-900 dark:text-white">Instagram DMs</h2>
                    </div>
                    <button
                        onClick={() => { setIsLoadingThreads(true); loadThreads(); }}
                        className="w-8 h-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center transition cursor-pointer text-slate-500"
                        title="Atualizar"
                    >
                        <i className={`fas fa-sync-alt text-sm ${isLoadingThreads ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>

                {/* Search */}
                <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
                    <div className="relative bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center px-3 py-2 border border-slate-200 dark:border-slate-700 focus-within:border-brand transition-colors">
                        <i className="fas fa-search text-slate-400 dark:text-slate-500 mr-2 text-sm"></i>
                        <input
                            type="text"
                            placeholder="Pesquisar conversa..."
                            className="bg-transparent border-none text-slate-900 dark:text-white text-sm w-full outline-none placeholder-slate-400 dark:placeholder-slate-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Thread List */}
                <div className="flex-1 overflow-y-auto">
                    {isLoadingThreads && threads.length === 0 ? (
                        <div className="flex justify-center p-10">
                            <i className="fas fa-circle-notch fa-spin text-brand text-2xl"></i>
                        </div>
                    ) : error ? (
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                                <i className="fas fa-exclamation-triangle text-red-500 text-xl"></i>
                            </div>
                            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
                            <button
                                onClick={() => { setError(''); setIsLoadingThreads(true); loadThreads(); }}
                                className="text-sm text-brand hover:underline cursor-pointer"
                            >
                                Tentar novamente
                            </button>
                        </div>
                    ) : filteredThreads.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-sm">
                            {threads.length === 0
                                ? 'Nenhuma conversa do Instagram ainda. Quando alguem enviar uma DM, aparecera aqui.'
                                : 'Nenhuma conversa encontrada.'}
                        </div>
                    ) : (
                        filteredThreads.map(thread => (
                            <div
                                key={thread.thread_id}
                                onClick={() => handleSelectThread(thread)}
                                className={`flex items-center gap-3 p-3 cursor-pointer border-b border-slate-100/50 dark:border-slate-800/50 transition-colors group
                                    ${selectedThread?.thread_id === thread.thread_id ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                            >
                                <div className="relative shrink-0">
                                    <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-700 dark:text-white text-lg">
                                        {thread.user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                                        <i className="fab fa-instagram text-white text-[7px]"></i>
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-0.5">
                                        <h3 className="font-semibold text-slate-900 dark:text-white truncate text-sm">{thread.user.name}</h3>
                                        <span className="text-[11px] text-slate-500 shrink-0 ml-2">
                                            {formatTime(thread.updated_time)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className="text-sm truncate pr-2 text-slate-500 dark:text-slate-400">
                                            {thread.last_msg || 'Nova conversa'}
                                        </p>
                                        {thread.lead_info && (
                                            <span
                                                className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                                                style={{ backgroundColor: thread.lead_info.color + '20', color: thread.lead_info.color }}
                                            >
                                                {thread.lead_info.status}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            {selectedThread ? (
                <div className="flex-1 flex flex-col bg-slate-100 dark:bg-[#0b141a] relative">
                    <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'url("https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png")' }}></div>

                    {/* Chat Header */}
                    <div className="h-16 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-4 flex items-center justify-between shrink-0 relative z-10 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center font-bold text-slate-700 dark:text-white">
                                    {selectedThread.user.name.charAt(0).toUpperCase()}
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white leading-tight">{selectedThread.user.name}</h3>
                                <span className="text-xs text-slate-500 dark:text-slate-400">@{selectedThread.user.username}</span>
                            </div>
                        </div>

                        <button
                            onClick={() => loadMessages(selectedThread.thread_id)}
                            className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
                            title="Atualizar mensagens"
                        >
                            <i className={`fas fa-sync-alt ${isLoadingMessages ? 'fa-spin' : ''}`}></i>
                        </button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-2 relative z-10 flex flex-col">
                        {isLoadingMessages ? (
                            <div className="flex-1 flex items-center justify-center">
                                <i className="fas fa-circle-notch fa-spin text-brand text-2xl"></i>
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                                Nenhuma mensagem nesta conversa.
                            </div>
                        ) : (
                            <>
                                {messages.map((msg) => (
                                    <div key={msg.id} className={`flex ${msg.is_sent_by_me ? 'justify-end' : 'justify-start'}`}>
                                        <div
                                            className={`max-w-[75%] md:max-w-[60%] rounded-2xl px-4 py-2 relative shadow-sm ${msg.is_sent_by_me
                                                ? 'bg-brand text-white rounded-tr-sm'
                                                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-sm border border-slate-200 dark:border-slate-700'
                                            }`}
                                        >
                                            <p className="text-[15px] leading-relaxed break-words">{msg.text}</p>
                                            <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${msg.is_sent_by_me ? 'text-blue-200' : 'text-slate-400'}`}>
                                                <span>{formatTime(msg.created_time)}</span>
                                                {msg.is_sent_by_me && (
                                                    <i className="fas fa-check text-xs"></i>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </>
                        )}
                    </div>

                    {/* Message Input */}
                    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md p-3 px-4 shrink-0 flex items-center gap-3 relative z-10 border-t border-slate-200 dark:border-slate-700">
                        <form onSubmit={handleSendMessage} className="flex-1">
                            <input
                                type="text"
                                placeholder="Digite uma mensagem..."
                                className="w-full bg-slate-100 dark:bg-slate-700/50 text-slate-900 dark:text-white rounded-xl py-3 px-4 focus:outline-none focus:ring-1 focus:ring-brand border border-slate-200 dark:border-slate-600/50 placeholder-slate-400"
                                value={messageInput}
                                onChange={(e) => setMessageInput(e.target.value)}
                                disabled={isSending}
                            />
                        </form>

                        {messageInput.trim() ? (
                            <button
                                onClick={handleSendMessage}
                                disabled={isSending}
                                className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center hover:opacity-90 transition cursor-pointer shadow-lg disabled:opacity-50"
                            >
                                <i className={`fas ${isSending ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'} text-sm`}></i>
                            </button>
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-400">
                                <i className="fab fa-instagram text-sm"></i>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Empty State */
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0b141a] border-l border-slate-200 dark:border-slate-800">
                    <div className="w-24 h-24 mb-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <i className="fab fa-instagram text-white text-4xl"></i>
                    </div>
                    <h2 className="text-2xl font-light text-slate-700 dark:text-slate-300 mb-3">Instagram DMs</h2>
                    <p className="text-slate-500 dark:text-slate-500 text-center max-w-md text-sm">
                        Receba e responda mensagens do Instagram diretamente pelo CRM.
                        <br />Selecione uma conversa ao lado para comecar.
                    </p>
                    {threads.length === 0 && !isLoadingThreads && !error && (
                        <p className="mt-4 text-xs text-slate-400 text-center max-w-sm">
                            As conversas aparecem aqui quando alguem envia uma DM para sua conta do Instagram conectada.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
