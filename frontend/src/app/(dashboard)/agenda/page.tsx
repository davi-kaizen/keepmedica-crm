'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
import type { Appointment } from '@/types';

const PROCEDURE_COLORS: Record<string, string> = {
    'Avaliação': 'bg-blue-500',
    'Limpeza': 'bg-green-500',
    'Canal': 'bg-purple-500',
    'Estética': 'bg-pink-500',
    'Cirurgia': 'bg-red-500',
};

type Doctor = { id: number; name: string; visible: number };

function MiniCalendar({ currentDate, onSelectDate }: { currentDate: Date; onSelectDate: (d: Date) => void }) {
    const [viewMonth, setViewMonth] = useState(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));

    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const changeMonth = (offset: number) => {
        setViewMonth(new Date(year, month + offset, 1));
    };

    const goToToday = () => {
        const now = new Date();
        setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
        onSelectDate(now);
    };

    const monthName = viewMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    return (
        <div className="bg-slate-50 dark:bg-[#0f1419] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <button onClick={() => changeMonth(-1)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer">
                    <i className="fas fa-chevron-left text-[10px]"></i>
                </button>
                <button onClick={goToToday} className="text-[13px] font-semibold text-slate-900 dark:text-white capitalize hover:text-brand transition cursor-pointer">{monthName}</button>
                <button onClick={() => changeMonth(1)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer">
                    <i className="fas fa-chevron-right text-[10px]"></i>
                </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
                {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                    <span key={i} className="text-[10px] font-bold text-slate-400 dark:text-slate-600 py-1 uppercase">{d}</span>
                ))}
                {cells.map((day, i) => {
                    if (day === null) return <span key={i} />;
                    const cellDate = new Date(year, month, day);
                    const isToday = today.toDateString() === cellDate.toDateString();
                    const isSelected = currentDate.toDateString() === cellDate.toDateString();
                    return (
                        <button
                            key={i}
                            onClick={() => onSelectDate(cellDate)}
                            className={`w-7 h-7 rounded-lg text-xs font-medium transition cursor-pointer flex items-center justify-center mx-auto
                                ${isSelected ? 'bg-brand text-white shadow-sm shadow-brand/20' : isToday ? 'bg-brand/15 text-brand ring-1 ring-brand/30' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}
                            `}
                        >
                            {day}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default function AgendaPage() {
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
    const [showNewApptModal, setShowNewApptModal] = useState(false);
    const [showApptDetail, setShowApptDetail] = useState<Appointment | null>(null);
    const [newAppt, setNewAppt] = useState({ patient_name: '', doctor_name: '', date_str: '', time_str: '', procedure: '', duration: '30', notes: '' });
    const [showNewDoctorModal, setShowNewDoctorModal] = useState(false);
    const [newDoctor, setNewDoctor] = useState({ name: '', specialization: '' });
    const [localDoctors, setLocalDoctors] = useState<string[]>([]);

    const loadData = () => {
        setIsLoading(true);
        fetchApi('/appointments/all')
            .then(data => {
                setAppointments(data.appointments || []);
                setDoctors(data.doctors || []);
            })
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    };

    useEffect(() => { loadData(); }, []);

    const hours = Array.from({ length: 12 }, (_, i) => i + 8);
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const getDaysInCurrentWeek = () => {
        const curr = new Date(currentDate);
        const first = curr.getDate() - curr.getDay();
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(curr);
            d.setDate(first + i);
            return d;
        });
    };

    const weekDays = getDaysInCurrentWeek();

    const getApptsForSlot = (date: Date, hour: number) => {
        const dateStr = date.toISOString().split('T')[0];
        return appointments.filter(a => {
            const aHour = parseInt(a.time_str.split(':')[0]);
            const doctorMatch = selectedDoctor ? a.doctor_name === selectedDoctor : true;
            return a.date_str === dateStr && aHour === hour && doctorMatch;
        });
    };

    const changeWeek = (offset: number) => {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() + (offset * 7));
        setCurrentDate(newDate);
    };

    const handleSelectDate = (date: Date) => {
        setCurrentDate(date);
    };

    const handleCreateAppt = async () => {
        if (!newAppt.patient_name.trim() || !newAppt.doctor_name || !newAppt.date_str || !newAppt.time_str) return;
        try {
            const res = await fetchApi('/appointments/create', {
                method: 'POST',
                body: JSON.stringify({
                    ...newAppt,
                    duration: parseInt(newAppt.duration) || 30
                })
            });
            if (res.success) {
                setNewAppt({ patient_name: '', doctor_name: '', date_str: '', time_str: '', procedure: '', duration: '30', notes: '' });
                setShowNewApptModal(false);
                loadData();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleDeleteAppt = async (id: number) => {
        if (!confirm('Cancelar esta consulta?')) return;
        setAppointments(prev => prev.filter(a => a.id !== id));
        setShowApptDetail(null);
        try {
            await fetchApi('/appointments/delete', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
        } catch (err) {
            console.error(err);
        }
    };

    const uniqueDoctors = Array.from(new Set([...appointments.map(a => a.doctor_name), ...localDoctors]));

    const handleAddDoctor = () => {
        if (!newDoctor.name.trim()) return;
        setLocalDoctors(prev => prev.includes(newDoctor.name) ? prev : [...prev, newDoctor.name]);
        setNewDoctor({ name: '', specialization: '' });
        setShowNewDoctorModal(false);
    };

    return (
        <div className="h-full flex">
            {/* Sidebar */}
            <div className="w-[300px] border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0A0A0A] shrink-0 flex flex-col pt-5 z-10 hidden md:flex overflow-y-auto">
                <div className="px-5 mb-5">
                    <button
                        onClick={() => setShowNewApptModal(true)}
                        className="w-full bg-brand hover:bg-brand/90 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-brand/15 transition-all flex justify-center items-center gap-2 cursor-pointer"
                    >
                        <i className="fas fa-plus text-sm"></i> Nova Consulta
                    </button>
                </div>

                {/* Mini Calendar */}
                <div className="px-5 mb-5">
                    <MiniCalendar currentDate={currentDate} onSelectDate={handleSelectDate} />
                </div>

                {/* Doctors */}
                <div className="px-5 mb-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Profissionais</h3>
                    </div>
                    <div className="space-y-1">
                        <div
                            onClick={() => setSelectedDoctor(null)}
                            className={`flex items-center gap-3 cursor-pointer group p-2.5 rounded-xl transition ${!selectedDoctor ? 'bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50' : 'hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'}`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm ${!selectedDoctor ? 'bg-brand/15 text-brand' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                                <i className="fas fa-users"></i>
                            </div>
                            <span className={`text-sm font-semibold ${!selectedDoctor ? 'text-slate-900 dark:text-white' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200'}`}>
                                Todos
                            </span>
                        </div>

                        {uniqueDoctors.length === 0 && !isLoading && (
                            <p className="text-xs text-slate-600 pl-2 py-2">Nenhum profissional com consulta.</p>
                        )}

                        {uniqueDoctors.map((doc, idx) => (
                            <div
                                key={idx}
                                onClick={() => setSelectedDoctor(doc)}
                                className={`flex items-center gap-3 cursor-pointer group p-2.5 rounded-xl transition ${selectedDoctor === doc ? 'bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50' : 'hover:bg-slate-100 dark:hover:bg-slate-800/40 border border-transparent'}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white shrink-0 text-xs bg-gradient-to-br from-indigo-500 to-purple-600 ${selectedDoctor === doc ? 'ring-2 ring-brand ring-offset-1 ring-offset-white dark:ring-offset-[#0A0A0A]' : ''}`}>
                                    {doc.charAt(0)}
                                </div>
                                <p className={`text-sm font-semibold truncate ${selectedDoctor === doc ? 'text-slate-900 dark:text-white' : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200'}`}>
                                    {doc}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* + Novo Doutor */}
                    <button
                        onClick={() => setShowNewDoctorModal(true)}
                        className="w-full mt-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30 rounded-xl py-2.5 text-sm font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                    >
                        <i className="fas fa-user-md text-xs"></i> Novo Doutor
                    </button>
                </div>
            </div>

            {/* Main Calendar */}
            <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0A0A0A] overflow-hidden relative">
                <div className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 shrink-0 bg-white/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl sticky top-0 z-20">
                    <div className="flex items-center gap-5">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white capitalize hidden sm:block tracking-tight">
                            {currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                        </h2>
                        <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                            <button onClick={() => changeWeek(-1)} className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer">
                                <i className="fas fa-chevron-left text-xs"></i>
                            </button>
                            <button onClick={() => setCurrentDate(new Date())} className="px-3.5 h-8 rounded-md text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer">
                                Hoje
                            </button>
                            <button onClick={() => changeWeek(1)} className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer">
                                <i className="fas fa-chevron-right text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <i className="fas fa-circle-notch fa-spin text-4xl text-brand"></i>
                    </div>
                ) : (
                    <div className="flex-1 overflow-auto flex relative">
                        <div className="w-16 flex flex-col shrink-0 border-r border-slate-200 dark:border-slate-800 sticky left-0 bg-white dark:bg-slate-900 z-10 mt-12">
                            {hours.map(h => (
                                <div key={h} className="h-[60px] border-b border-slate-100 dark:border-slate-800 flex items-start justify-center pt-2">
                                    <span className="text-[10px] text-slate-500 font-medium">{h}:00</span>
                                </div>
                            ))}
                        </div>

                        <div className="flex-1 flex flex-col min-w-[700px]">
                            <div className="flex border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white/95 dark:bg-slate-900/95 z-10 backdrop-blur">
                                {weekDays.map((date, i) => {
                                    const isToday = new Date().toDateString() === date.toDateString();
                                    return (
                                        <div key={i} className={`flex-1 min-w-[100px] py-3 text-center border-r border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center group ${isToday ? 'bg-brand/10' : ''}`}>
                                            <span className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${isToday ? 'text-brand' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition'}`}>
                                                {days[date.getDay()]}
                                            </span>
                                            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-lg font-black ${isToday ? 'bg-brand text-white shadow-lg shadow-brand/30' : 'text-slate-600 dark:text-slate-300'}`}>
                                                {date.getDate()}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex-1 flex relative">
                                <div className="absolute inset-0 flex flex-col pointer-events-none">
                                    {hours.map(h => (
                                        <div key={h} className="h-[60px] border-b border-slate-100 dark:border-slate-800/50 w-full"></div>
                                    ))}
                                </div>

                                {weekDays.map((date, i) => (
                                    <div key={i} className="flex-1 min-w-[100px] border-r border-slate-100 dark:border-slate-800/50 relative">
                                        {hours.map((h) => {
                                            const appts = getApptsForSlot(date, h);
                                            return (
                                                <div key={`${i}-${h}`} className="h-[60px] relative p-1 group">
                                                    {appts.map(appt => (
                                                        <div
                                                            key={appt.id}
                                                            onClick={() => setShowApptDetail(appt)}
                                                            className={`absolute left-1 right-1 inset-y-1 rounded-md p-2 cursor-pointer shadow-md hover:shadow-lg transition-all border border-black/20 overflow-hidden flex flex-col justify-start z-10 hover:z-20 transform hover:-translate-y-0.5 ${PROCEDURE_COLORS[appt.procedure] || 'bg-brand'}`}
                                                        >
                                                            <div className="absolute top-0 right-0 w-2 h-full bg-white/20"></div>
                                                            <p className="text-[10px] font-bold text-white/90 truncate leading-tight flex items-center gap-1">
                                                                <i className="far fa-clock text-[8px]"></i> {appt.time_str}
                                                            </p>
                                                            <p className="text-xs font-black text-white truncate my-0.5">{appt.patient_name}</p>
                                                            <p className="text-[9px] text-white/80 truncate font-semibold uppercase">{appt.procedure}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Appointment Detail Modal */}
            {showApptDetail && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowApptDetail(null)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[450px] shadow-2xl animate-fade-in-up overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className={`h-2 ${PROCEDURE_COLORS[showApptDetail.procedure] || 'bg-brand'}`}></div>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{showApptDetail.patient_name}</h3>
                                <p className="text-sm font-medium text-brand"><i className="fas fa-stethoscope mr-1"></i> {showApptDetail.doctor_name}</p>
                            </div>
                            <button onClick={() => setShowApptDetail(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer transition">&times;</button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700/50">
                                <div className="w-12 h-12 rounded-lg bg-orange-500/20 text-orange-500 flex items-center justify-center text-xl shrink-0">
                                    <i className="far fa-calendar-alt"></i>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-0.5">Data e Hora</p>
                                    <p className="text-sm text-slate-900 dark:text-white font-medium">{showApptDetail.date_str} às {showApptDetail.time_str}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5"><i className="far fa-clock"></i> Duração: {showApptDetail.duration} min</p>
                                </div>
                            </div>
                            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700/50">
                                <div>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Procedimento</p>
                                    <span className={`text-xs font-bold text-white px-3 py-1 rounded-full ${PROCEDURE_COLORS[showApptDetail.procedure] || 'bg-brand'}`}>
                                        {showApptDetail.procedure}
                                    </span>
                                </div>
                            </div>
                            {showApptDetail.notes && (
                                <div>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Observações</p>
                                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-200/90 p-3 rounded-lg text-sm italic">
                                        {showApptDetail.notes}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                            <button
                                onClick={() => handleDeleteAppt(showApptDetail.id)}
                                className="px-5 py-2 rounded-lg text-sm font-bold text-white bg-red-500 hover:bg-red-600 shadow shadow-red-900/50 cursor-pointer"
                            >
                                Cancelar Consulta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Appointment Modal */}
            {showNewApptModal && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowNewApptModal(false)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[500px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white"><i className="far fa-calendar-plus text-brand mr-2"></i>Nova Consulta</h3>
                            <button onClick={() => setShowNewApptModal(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Paciente *</label>
                                <input value={newAppt.patient_name} onChange={e => setNewAppt({ ...newAppt, patient_name: e.target.value })} placeholder="Nome do paciente" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500" autoFocus />
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Profissional *</label>
                                <select value={newAppt.doctor_name} onChange={e => setNewAppt({ ...newAppt, doctor_name: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand">
                                    <option value="">Selecione...</option>
                                    {doctors.map(d => (
                                        <option key={d.id} value={d.name}>{d.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block font-bold">Data *</label>
                                    <input type="date" value={newAppt.date_str} onChange={e => setNewAppt({ ...newAppt, date_str: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block font-bold">Hora *</label>
                                    <input type="time" value={newAppt.time_str} onChange={e => setNewAppt({ ...newAppt, time_str: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block font-bold">Procedimento</label>
                                    <select value={newAppt.procedure} onChange={e => setNewAppt({ ...newAppt, procedure: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand">
                                        <option value="">Selecione...</option>
                                        {Object.keys(PROCEDURE_COLORS).map(p => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block font-bold">Duração (min)</label>
                                    <input type="number" value={newAppt.duration} onChange={e => setNewAppt({ ...newAppt, duration: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Observações</label>
                                <textarea value={newAppt.notes} onChange={e => setNewAppt({ ...newAppt, notes: e.target.value })} placeholder="Notas adicionais..." rows={2} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-brand placeholder-slate-400 dark:placeholder-slate-500 resize-none" />
                            </div>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button onClick={handleCreateAppt} disabled={!newAppt.patient_name.trim() || !newAppt.doctor_name || !newAppt.date_str || !newAppt.time_str} className="flex-1 bg-brand hover:opacity-90 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-50 shadow-lg shadow-brand/20">
                                <i className="fas fa-plus mr-2"></i>Agendar Consulta
                            </button>
                            <button onClick={() => setShowNewApptModal(false)} className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer">Cancelar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Doctor Modal */}
            {showNewDoctorModal && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center backdrop-blur-sm" onClick={() => setShowNewDoctorModal(false)}>
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl w-[420px] shadow-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                                <i className="fas fa-user-md text-emerald-500 mr-2"></i>Novo Profissional
                            </h3>
                            <button onClick={() => setShowNewDoctorModal(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl cursor-pointer">&times;</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Nome do Profissional *</label>
                                <input
                                    value={newDoctor.name}
                                    onChange={e => setNewDoctor({ ...newDoctor, name: e.target.value })}
                                    placeholder="Dr. João Silva"
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-400 dark:placeholder-slate-500"
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleAddDoctor()}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-slate-500 mb-1 block font-bold">Especialização</label>
                                <input
                                    value={newDoctor.specialization}
                                    onChange={e => setNewDoctor({ ...newDoctor, specialization: e.target.value })}
                                    placeholder="Ex: Ortodontia, Implante..."
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-400 dark:placeholder-slate-500"
                                    onKeyDown={e => e.key === 'Enter' && handleAddDoctor()}
                                />
                            </div>
                        </div>
                        <div className="p-6 pt-0 flex gap-3">
                            <button
                                onClick={handleAddDoctor}
                                disabled={!newDoctor.name.trim()}
                                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold transition cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                            >
                                <i className="fas fa-plus mr-2"></i>Adicionar
                            </button>
                            <button
                                onClick={() => setShowNewDoctorModal(false)}
                                className="px-6 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white py-3 rounded-xl font-bold transition cursor-pointer"
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
