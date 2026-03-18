'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import Spline from '@splinetool/react-spline';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPwd, setAdminPwd] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Registration state
  const [isRegister, setIsRegister] = useState(false);
  const [register, setRegister] = useState({ cpf: '', fullName: '', profileName: '', phone: '', password: '' });
  const [registerError, setRegisterError] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);

  // Hidden admin shortcut (keyboard listener only, no visible UI hint)
  useEffect(() => {
    const keys = new Set<string>();
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
      if (keys.has('a') && keys.has('d') && keys.has('m')) {
        setShowAdminModal(true);
        keys.clear();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setIsLoading(true);
    setError('');
    // Limpeza preventiva: remove dados de sessões anteriores antes de autenticar
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try {
      const res = await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (res.success) {
        router.push('/hub');
      } else {
        setError(res.error || 'Login Falhou');
      }
    } catch {
      setError('Erro de conexão com o servidor');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!register.fullName.trim() || !register.profileName.trim() || !register.password.trim()) {
      setRegisterError('Preencha os campos obrigatórios.');
      return;
    }
    setRegisterLoading(true);
    setRegisterError('');
    try {
      const res = await fetchApi('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          cpf: register.cpf,
          full_name: register.fullName,
          username: register.profileName,
          phone: register.phone,
          password: register.password,
        }),
      });
      if (res.success) {
        setIsRegister(false);
        setUsername(register.profileName);
        setPassword('');
        setRegister({ cpf: '', fullName: '', profileName: '', phone: '', password: '' });
        setError('');
        setSuccessMsg('Conta criada com sucesso! Faça login.');
      } else {
        setRegisterError(res.error || 'Erro ao criar conta');
      }
    } catch (err) {
      console.error('Register error:', err);
      setRegisterError('Erro de conexão com o servidor');
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleAdminAuth = async () => {
    if (!adminPwd.trim()) return;
    try {
      const res = await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'admin', password: adminPwd }),
      });
      if (res.success) {
        router.push('/hub');
      }
    } catch {
      console.error('Admin auth failed');
    }
  };

  const switchToRegister = () => {
    setIsRegister(true);
    setError('');
    setSuccessMsg('');
    setRegisterError('');
  };

  const switchToLogin = () => {
    setIsRegister(false);
    setError('');
    setRegisterError('');
  };

  const inputClass = "w-full pl-11 pr-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200/80 text-slate-900 rounded-xl focus:ring-2 focus:ring-[#206aba]/20 focus:border-[#206aba] outline-none transition placeholder-slate-400 shadow-sm";

  return (
    <div className="fixed inset-0 z-50 grid lg:grid-cols-[40%_60%] h-screen bg-[#f5f7fa]">

      {/* ===== Left Column — Form ===== */}
      <div className="flex items-center justify-center p-8 relative z-10 lg:pl-12 bg-[#f5f7fa]">
        <div className="w-full max-w-[380px] text-center">
          {/* Logo */}
          <div className="w-[68px] h-[68px] bg-[#206aba] rounded-2xl mx-auto flex items-center justify-center text-white text-4xl font-bold mb-6 shadow-lg shadow-blue-300/30">
            K
          </div>
          <h2 className="text-3xl font-extrabold text-slate-900 mb-1">
            <span className="text-[#206aba]">Keep</span>Medica
          </h2>
          <p className="text-sm text-slate-500 mb-8 font-medium">
            {isRegister ? 'Crie sua conta para começar.' : 'Gestão inteligente para sua clínica.'}
          </p>

          {!isRegister ? (
            /* ===== LOGIN FORM ===== */
            <>
              <form onSubmit={handleLogin} className="space-y-4 text-left">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">Usuário</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="far fa-user text-slate-400"></i>
                    </div>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className={inputClass}
                      placeholder="Seu usuário"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">Senha</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fas fa-lock text-slate-400"></i>
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={inputClass}
                      placeholder="Sua senha"
                      required
                    />
                  </div>
                </div>
                {successMsg && (
                  <div className="text-emerald-700 text-sm font-medium bg-emerald-50 border border-emerald-200 rounded-xl py-2.5 px-4 flex items-center gap-2">
                    <i className="fas fa-check-circle"></i>
                    {successMsg}
                  </div>
                )}
                {error && (
                  <div className="text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl py-2.5 px-4 flex items-center gap-2">
                    <i className="fas fa-exclamation-circle"></i>
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 bg-[#206aba] hover:bg-[#1a5ba0] text-white font-bold text-base rounded-xl transition-all shadow-lg shadow-blue-500/20 mt-3 cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? (
                    <i className="fas fa-circle-notch fa-spin"></i>
                  ) : (
                    'Acessar Plataforma'
                  )}
                </button>
              </form>

              <button
                onClick={switchToRegister}
                className="mt-4 w-full py-3 border border-slate-200 text-slate-600 hover:text-[#206aba] hover:border-[#206aba]/30 hover:bg-[#206aba]/5 font-semibold text-sm rounded-xl transition-all cursor-pointer"
              >
                Criar Conta
              </button>
            </>
          ) : (
            /* ===== REGISTER FORM ===== */
            <>
              <form onSubmit={handleRegister} className="space-y-3.5 text-left">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">CPF</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="far fa-id-card text-slate-400"></i>
                    </div>
                    <input
                      value={register.cpf}
                      onChange={(e) => setRegister({ ...register, cpf: e.target.value })}
                      className={inputClass}
                      placeholder="000.000.000-00"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">Nome Completo *</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="far fa-user text-slate-400"></i>
                    </div>
                    <input
                      value={register.fullName}
                      onChange={(e) => setRegister({ ...register, fullName: e.target.value })}
                      className={inputClass}
                      placeholder="Seu nome completo"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">Nome de Perfil *</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fas fa-at text-slate-400"></i>
                    </div>
                    <input
                      value={register.profileName}
                      onChange={(e) => setRegister({ ...register, profileName: e.target.value })}
                      className={inputClass}
                      placeholder="Nome de exibição"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">Telefone</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fas fa-phone text-slate-400"></i>
                    </div>
                    <input
                      value={register.phone}
                      onChange={(e) => setRegister({ ...register, phone: e.target.value })}
                      className={inputClass}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-900 mb-1.5 uppercase tracking-wider">Senha *</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fas fa-lock text-slate-400"></i>
                    </div>
                    <input
                      type="password"
                      value={register.password}
                      onChange={(e) => setRegister({ ...register, password: e.target.value })}
                      className={inputClass}
                      placeholder="Crie uma senha"
                      required
                    />
                  </div>
                </div>
                {registerError && (
                  <div className="text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl py-2.5 px-4 flex items-center gap-2">
                    <i className="fas fa-exclamation-circle"></i>
                    {registerError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={registerLoading}
                  className="w-full py-3.5 bg-[#206aba] hover:bg-[#1a5ba0] text-white font-bold text-base rounded-xl transition-all shadow-lg shadow-blue-500/20 mt-2 cursor-pointer disabled:opacity-50"
                >
                  {registerLoading ? (
                    <i className="fas fa-circle-notch fa-spin"></i>
                  ) : (
                    'Criar Conta'
                  )}
                </button>
              </form>

              <button
                onClick={switchToLogin}
                className="mt-4 w-full py-3 border border-slate-200 text-slate-600 hover:text-[#206aba] hover:border-[#206aba]/30 hover:bg-[#206aba]/5 font-semibold text-sm rounded-xl transition-all cursor-pointer"
              >
                <i className="fas fa-arrow-left mr-2 text-xs"></i>Voltar ao Login
              </button>
            </>
          )}

          <div className="mt-8 pt-6 border-t border-slate-200/60 text-xs text-slate-400">
            <p>
              Precisa de ajuda?{' '}
              <a href="#" className="text-[#206aba] hover:underline font-medium">
                Fale com o suporte.
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* ===== Right Column — Spline 3D (hidden on mobile) ===== */}
      <div className="hidden lg:block relative overflow-hidden bg-[#f5f7fa] h-full -ml-28">
        <div className="absolute inset-0 -right-28">
          <Spline scene="https://prod.spline.design/6-teRl0ldF0gl1ZL/scene.splinecode" />
        </div>
        {/* Bottom cover to clip Spline watermark */}
        <div className="absolute bottom-0 left-0 right-0 h-14 bg-[#f5f7fa] z-10" />
        {/* Branding at bottom */}
        <div className="absolute bottom-4 left-0 right-0 text-center z-20">
          <p className="text-slate-400/60 text-[11px] font-medium tracking-widest uppercase">
            CRM Inteligente para Clínicas
          </p>
        </div>
      </div>

      {/* ===== Admin Modal (hidden Easter Egg — no visual hints) ===== */}
      {showAdminModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center backdrop-blur-sm">
          <div className="text-center animate-fade-in-up bg-gray-900 p-10 rounded-2xl border border-gray-700 shadow-2xl">
            <i className="fas fa-user-shield text-5xl text-green-500 mb-4 animate-pulse"></i>
            <h2 className="text-xl text-white font-mono mb-6 tracking-widest">
              PAINEL ADMINISTRATIVO
            </h2>
            <input
              value={adminPwd}
              onChange={(e) => setAdminPwd(e.target.value)}
              type="password"
              className="bg-gray-800 text-white border border-green-500/50 p-3.5 rounded-lg text-center w-64 text-lg outline-none mb-6 focus:ring-2 focus:ring-green-500 transition"
              placeholder="SENHA MESTRA"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAdminAuth()}
            />
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleAdminAuth}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-2.5 rounded-lg font-bold transition shadow-lg cursor-pointer"
              >
                ACESSAR
              </button>
              <button
                onClick={() => setShowAdminModal(false)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2.5 rounded-lg transition cursor-pointer"
              >
                SAIR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
