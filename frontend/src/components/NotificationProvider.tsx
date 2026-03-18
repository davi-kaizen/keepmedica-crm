'use client';

import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

type Toast = {
    id: number;
    leadName: string;
};

type NotificationContextType = {
    hasNewMessage: boolean;
    triggerNotification: (leadName?: string) => void;
    clearNotification: () => void;
};

const NotificationContext = createContext<NotificationContextType>({
    hasNewMessage: false,
    triggerNotification: () => {},
    clearNotification: () => {},
});

export function useNotification() {
    return useContext(NotificationContext);
}

export default function NotificationProvider({ children }: { children: React.ReactNode }) {
    const [hasNewMessage, setHasNewMessage] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const toastIdRef = useRef(0);

    useEffect(() => {
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.5;
        audioRef.current = audio;
    }, []);

    const triggerNotification = useCallback((leadName?: string) => {
        setHasNewMessage(true);
        try {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(() => {});
            }
        } catch { /* silent - browser may block autoplay */ }

        // Show toast
        const id = ++toastIdRef.current;
        const name = leadName || 'Lead';
        setToasts(prev => [...prev, { id, leadName: name }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const clearNotification = useCallback(() => {
        setHasNewMessage(false);
    }, []);

    return (
        <NotificationContext.Provider value={{ hasNewMessage, triggerNotification, clearNotification }}>
            {children}

            {/* Toast container */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className="pointer-events-auto animate-fade-in-up bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[280px] max-w-[380px]"
                        style={{ animation: 'fadeInUp 0.3s ease-out' }}
                    >
                        <div className="w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                            <i className="fab fa-instagram text-brand text-sm"></i>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                Nova mensagem de {toast.leadName}
                            </p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500">Instagram Direct</p>
                        </div>
                        <div className="w-2 h-2 rounded-full bg-brand animate-pulse shrink-0"></div>
                    </div>
                ))}
            </div>
        </NotificationContext.Provider>
    );
}
