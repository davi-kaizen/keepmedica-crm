'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchApi } from '@/lib/api';
import type { Lead } from '@/types';

type ChatBubble = {
    id: string;
    text: string;
    sender: 'agent' | 'lead';
    time: string;
    status?: 'sent' | 'read';
};

export default function ChatPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [selectedChat, setSelectedChat] = useState<Lead | null>(null);
    const [messages, setMessages] = useState<ChatBubble[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [messageInput, setMessageInput] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const chatHistoryRef = useRef<Record<number, ChatBubble[]>>({});

    const getMessagesForChat = (lead: Lead) => {
        const existing = chatHistoryRef.current[lead.id];
        if (existing) return existing;

        const seeded: ChatBubble[] = [
            { id: `seed-${lead.id}-1`, text: `Olá ${lead.name}, como podemos ajudar?`, sender: 'agent', time: '10:00', status: 'read' }
        ];
        if (lead.last_msg) {
            seeded.push({ id: `seed-${lead.id}-2`, text: lead.last_msg, sender: 'lead', time: '10:05', status: 'read' });
        }
        chatHistoryRef.current[lead.id] = seeded;
        return seeded;
    };

    const appendMessage = (leadId: number, message: ChatBubble) => {
        const current = chatHistoryRef.current[leadId] || [];
        chatHistoryRef.current[leadId] = [...current, message];
    };

    useEffect(() => {
        fetchApi('/kanban/data')
            .then(data => {
                const sortedLeads = (data.leads || []).sort(
                    (a: Lead, b: Lead) => new Date(b.last_interaction).getTime() - new Date(a.last_interaction).getTime()
                );
                setLeads(sortedLeads);
                if (sortedLeads.length > 0) {
                    const first = sortedLeads[0];
                    setSelectedChat(first);
                    setMessages(getMessagesForChat(first));
                }
            })
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    }, []);

    const filteredLeads = leads.filter(l =>
        l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.last_msg.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !selectedChat) return;

        const now = new Date();
        const newMsg: ChatBubble = {
            id: `local-${now.getTime()}`,
            text: messageInput,
            sender: 'agent',
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'sent'
        };

        appendMessage(selectedChat.id, newMsg);
        setMessages(prev => [...prev, newMsg]);

        setLeads(prev => prev.map(l =>
            l.id === selectedChat.id ? { ...l, last_msg: messageInput, last_interaction: new Date().toISOString() } : l
        ));

        setMessageInput('');
    };

    const handleSelectChat = (lead: Lead) => {
        setSelectedChat(lead);
        setMessages(getMessagesForChat(lead));
    };

    return (
        <div className="h-full flex bg-slate-50 dark:bg-[#0A0A0A]">
            {/* Sidebar - Chat List */}
            <div className="w-[380px] border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col shrink-0 z-10 transition-transform md:translate-x-0 hidden md:flex">
                {/* Header */}
                <div className="h-16 border-b border-slate-200 dark:border-slate-700 p-4 shrink-0 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300">
                            <i className="fas fa-user"></i>
                        </div>
                        <h2 className="font-bold text-slate-900 dark:text-white">Mensagens</h2>
                    </div>
                    <div className="flex gap-2 text-slate-500 dark:text-slate-400">
                        <button className="w-8 h-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center transition cursor-pointer"><i className="fas fa-circle-notch"></i></button>
                        <button className="w-8 h-8 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center transition cursor-pointer"><i className="fas fa-plus"></i></button>
                    </div>
                </div>

                {/* Search */}
                <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
                    <div className="relative bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center px-3 py-2 border border-slate-200 dark:border-slate-700 focus-within:border-brand transition-colors">
                        <i className="fas fa-search text-slate-400 dark:text-slate-500 mr-2 text-sm"></i>
                        <input
                            type="text"
                            placeholder="Pesquisar ou começar uma nova conversa"
                            className="bg-transparent border-none text-slate-900 dark:text-white text-sm w-full outline-none placeholder-slate-400 dark:placeholder-slate-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Filters */}
                <div className="px-3 py-2 flex gap-2 shrink-0 border-b border-slate-200/50 dark:border-slate-700/50 overflow-x-auto scrollbar-hide">
                    <button className="bg-brand/20 text-brand px-3 py-1 rounded-full text-xs font-bold border border-brand/30 whitespace-nowrap">Tudo</button>
                    <button className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition cursor-pointer">Não lidas</button>
                    <button className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition cursor-pointer">Grupos</button>
                </div>

                {/* Chat List */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex justify-center p-10">
                            <i className="fas fa-circle-notch fa-spin text-brand text-2xl"></i>
                        </div>
                    ) : filteredLeads.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-sm">
                            Nenhuma conversa encontrada.
                        </div>
                    ) : (
                        filteredLeads.map(lead => (
                            <div
                                key={lead.id}
                                onClick={() => handleSelectChat(lead)}
                                className={`flex items-center gap-3 p-3 cursor-pointer border-b border-slate-100/50 dark:border-slate-800/50 transition-colors group
                  ${selectedChat?.id === lead.id ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}
                `}
                            >
                                <div className="relative shrink-0">
                                    {lead.profile_pic ? (
                                        <img src={lead.profile_pic} alt={lead.name} className="w-12 h-12 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-700 dark:text-white text-lg">
                                            {lead.name.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    {/* Mock platform icon */}
                                    <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-green-500 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                                        <i className="fab fa-whatsapp text-white text-[8px]"></i>
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-0.5">
                                        <h3 className="font-semibold text-slate-900 dark:text-white truncate text-sm">{lead.name}</h3>
                                        <span className="text-[11px] text-slate-500 shrink-0 ml-2">
                                            {new Date(lead.last_interaction).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className={`text-sm truncate pr-2 ${lead.unread_count > 0 ? 'text-slate-900 dark:text-white font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {lead.last_msg || 'Nova conversa iniciada'}
                                        </p>
                                        {lead.unread_count > 0 && (
                                            <span className="w-5 h-5 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                                {lead.unread_count}
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
            {selectedChat ? (
                <div className="flex-1 flex flex-col bg-slate-100 dark:bg-[#0b141a] relative">
                    {/* Chat Background Pattern (WhatsApp style) */}
                    <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'url("https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png")' }}></div>

                    {/* Chat Header */}
                    <div className="h-16 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-4 flex items-center justify-between shrink-0 relative z-10 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-4 cursor-pointer">
                            {/* Back button for mobile implicitly handled here if needed */}
                            <div className="relative">
                                {selectedChat.profile_pic ? (
                                    <img src={selectedChat.profile_pic} alt={selectedChat.name} className="w-10 h-10 rounded-full object-cover" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center font-bold text-slate-700 dark:text-white">
                                        {selectedChat.name.charAt(0).toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white leading-tight">{selectedChat.name}</h3>
                                <span className="text-xs text-slate-500 dark:text-slate-400">@{selectedChat.username}</span>
                            </div>
                        </div>

                        <div className="flex gap-4 text-slate-400 dark:text-slate-400">
                            <button className="hover:text-slate-700 dark:hover:text-white transition cursor-pointer"><i className="fas fa-video"></i></button>
                            <button className="hover:text-slate-700 dark:hover:text-white transition cursor-pointer"><i className="fas fa-phone"></i></button>
                            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 my-auto mx-1"></div>
                            <button className="hover:text-slate-700 dark:hover:text-white transition cursor-pointer"><i className="fas fa-search"></i></button>
                            <button className="hover:text-slate-700 dark:hover:text-white transition cursor-pointer"><i className="fas fa-ellipsis-v"></i></button>
                        </div>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-2 relative z-10 flex flex-col">
                        <div className="text-center my-4">
                            <span className="bg-white/80 dark:bg-slate-800/80 text-slate-500 dark:text-slate-300 text-xs px-3 py-1 rounded-lg uppercase tracking-wider font-semibold shadow border border-slate-200 dark:border-transparent">
                                Hoje
                            </span>
                        </div>

                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.sender === 'agent' ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[75%] md:max-w-[60%] rounded-2xl px-4 py-2 relative shadow-sm ${msg.sender === 'agent'
                                            ? 'bg-brand text-white rounded-tr-sm'
                                            : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-sm border border-slate-200 dark:border-slate-700'
                                        }`}
                                >
                                    <p className="text-[15px] leading-relaxed break-words">{msg.text}</p>
                                    <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${msg.sender === 'agent' ? 'text-brand-300' : 'text-slate-400'}`}>
                                        <span>{msg.time}</span>
                                        {msg.sender === 'agent' && (
                                            <i className={`fas fa-check-double ${msg.status === 'read' ? 'text-blue-300' : ''}`}></i>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Message Input Box */}
                    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md p-3 px-4 shrink-0 flex items-center gap-3 relative z-10 border-t border-slate-200 dark:border-slate-700">
                        <button className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 transition cursor-pointer text-xl">
                            <i className="far fa-smile"></i>
                        </button>
                        <button className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 transition cursor-pointer text-xl">
                            <i className="fas fa-paperclip"></i>
                        </button>

                        <form onSubmit={handleSendMessage} className="flex-1">
                            <input
                                type="text"
                                placeholder="Digite uma mensagem"
                                className="w-full bg-slate-100 dark:bg-slate-700/50 text-slate-900 dark:text-white rounded-xl py-3 px-4 focus:outline-none focus:ring-1 focus:ring-brand border border-slate-200 dark:border-slate-600/50 placeholder-slate-400"
                                value={messageInput}
                                onChange={(e) => setMessageInput(e.target.value)}
                            />
                        </form>

                        {messageInput.trim() ? (
                            <button
                                onClick={handleSendMessage}
                                className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center hover:opacity-90 transition cursor-pointer shadow-lg"
                            >
                                <i className="fas fa-paper-plane mr-1 text-sm"></i>
                            </button>
                        ) : (
                            <button className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 transition cursor-pointer text-xl">
                                <i className="fas fa-microphone"></i>
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                /* Empty State */
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0b141a] border-l border-slate-200 dark:border-slate-800">
                    <div className="w-64 h-64 mb-6 opacity-20 dark:opacity-30">
                        {/* Illustration placeholder */}
                        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                            <path fill="#206aba" d="M47.7,-64.5C60.2,-58.5,67.6,-41.8,70.6,-25.9C73.6,-10,72.2,5.2,65.8,18.8C59.4,32.4,48,44.4,34.2,53.4C20.4,62.4,4.2,68.4,-11.1,65.6C-26.4,62.8,-40.8,51.2,-53.4,39.3C-66,27.4,-76.8,15.2,-78.3,2.2C-79.8,-10.8,-72,-24.6,-61.8,-35.1C-51.6,-45.6,-39.1,-52.8,-26,-58.5C-12.9,-64.2,0.8,-68.4,14.6,-67.2C28.4,-66,42.2,-59.4,47.7,-64.5Z" transform="translate(100 100)" />
                        </svg>
                    </div>
                    <h2 className="text-3xl font-light text-slate-700 dark:text-slate-300 mb-4">KeepMedica Chat</h2>
                    <p className="text-slate-500 dark:text-slate-500 text-center max-w-md">
                        Envie e receba mensagens do WhatsApp e Instagram diretamente pelo seu CRM.
                        Selecione uma conversa ao lado para começar.
                    </p>
                    <div className="mt-8 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-600 bg-slate-100 dark:bg-slate-900/50 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-800">
                        <i className="fas fa-lock"></i> Criptografado de ponta-a-ponta
                    </div>
                </div>
            )}
        </div>
    );
}
