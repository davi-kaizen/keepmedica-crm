import sqlite3
import webbrowser
import threading
import time
import json
import os
import requests 
from datetime import datetime, timedelta
from flask import Flask, render_template_string, request, jsonify, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user

# ==============================================================================
# CONFIGURAÇÕES E CONSTANTES
# ==============================================================================
app = Flask(__name__)
app.secret_key = 'chave_super_secreta_crm_enterprise_ultimate_edition_v99'
DB_NAME = "local_crm.db"

# URL BASE DA API DA META
GRAPH_URL = "https://graph.facebook.com/v18.0"

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Cache em memória
USER_CACHES = {}

DEFAULT_STAGES = [
    ("NOVOS", "#206aba"),        
    ("QUALIFICACAO", "#f59e0b"), 
    ("PROPOSTA", "#8b5cf6"),        
    ("NEGOCIACAO", "#ec4899"),    
    ("FECHADO", "#10b981")
]

INITIAL_DOCTORS = [
    "Dr. Carlos F.", "Dr. Danilo A.", "Dr. Gabriel F.", "Dr. Marlon F.", 
    "Dr. Olavo V.", "Dra. Agatha", "Dra. Barbara", "Dra. Beatriz"
]

# ==============================================================================
# CAMADA DE BANCO DE DADOS
# ==============================================================================
def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS pipelines (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            name TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT,
            position INTEGER,
            pipeline_id INTEGER,
            FOREIGN KEY(pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT UNIQUE, 
            status TEXT, 
            last_msg TEXT,
            profile_pic TEXT,
            value REAL DEFAULT 0,
            last_interaction TEXT,
            unread_count INTEGER DEFAULT 0,
            pipeline_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            meta_token TEXT,
            ig_page_id TEXT,
            pipeline_id INTEGER DEFAULT 1,
            FOREIGN KEY(pipeline_id) REFERENCES pipelines(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            description TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            pipeline_id INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_name TEXT NOT NULL,
            doctor_name TEXT NOT NULL,
            date_str TEXT NOT NULL, 
            time_str TEXT NOT NULL, 
            notes TEXT,
            color TEXT DEFAULT '#206aba',
            pipeline_id INTEGER,
            procedure TEXT,
            duration INTEGER DEFAULT 30
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS doctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            visible INTEGER DEFAULT 1
        )
    ''')

    # NOVA TABELA DE ORÇAMENTOS / FINANCEIRO
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_name TEXT NOT NULL,
            cpf TEXT,
            phone TEXT,
            procedure TEXT,
            amount REAL DEFAULT 0,
            status TEXT DEFAULT 'PENDENTE',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            pipeline_id INTEGER,
            FOREIGN KEY(pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
        )
    ''')

    # --- MIGRAÇÕES AUTOMÁTICAS ---
    try:
        appt_cols = [c[1] for c in cursor.execute("PRAGMA table_info(appointments)")]
        if 'procedure' not in appt_cols:
            cursor.execute("ALTER TABLE appointments ADD COLUMN procedure TEXT")
        if 'duration' not in appt_cols:
            cursor.execute("ALTER TABLE appointments ADD COLUMN duration INTEGER DEFAULT 30")
        if 'color' not in appt_cols:
            cursor.execute("ALTER TABLE appointments ADD COLUMN color TEXT DEFAULT '#206aba'")
            
        doc_cols = [c[1] for c in cursor.execute("PRAGMA table_info(doctors)")]
        if 'visible' not in doc_cols:
            cursor.execute("ALTER TABLE doctors ADD COLUMN visible INTEGER DEFAULT 1")
            
        existing_lead_cols = [c[1] for c in cursor.execute("PRAGMA table_info(leads)")]
        if 'profile_pic' not in existing_lead_cols:
            cursor.execute("ALTER TABLE leads ADD COLUMN profile_pic TEXT")
        if 'created_at' not in existing_lead_cols:
            cursor.execute("ALTER TABLE leads ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP")
        
        existing_user_cols = [c[1] for c in cursor.execute("PRAGMA table_info(users)")]
        if 'meta_token' not in existing_user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN meta_token TEXT")
        if 'ig_page_id' not in existing_user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN ig_page_id TEXT")
            
    except Exception as e:
        print(f"[DB WARN] Erro na verificação de migração: {e}")

    # Inicializa Dados Padrão
    if cursor.execute("SELECT count(*) FROM pipelines").fetchone()[0] == 0:
        cursor.execute("INSERT INTO pipelines (id, name) VALUES (1, 'Pipeline Padrão')")
        for idx, (name, color) in enumerate(DEFAULT_STAGES):
            cursor.execute("INSERT INTO stages (name, color, position, pipeline_id) VALUES (?, ?, ?, 1)", (name, color, idx))
            
    if cursor.execute("SELECT count(*) FROM doctors").fetchone()[0] == 0:
        for doc_name in INITIAL_DOCTORS:
            cursor.execute("INSERT INTO doctors (name, visible) VALUES (?, 1)", (doc_name,))

    conn.commit()
    conn.close()

def log_action(user_id, description, pipeline_id, details=""):
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO activities (user_id, description, details, pipeline_id) VALUES (?, ?, ?, ?)", 
            (user_id, description, details, pipeline_id)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Erro ao logar atividade: {e}")

class User(UserMixin):
    def __init__(self, id, username, password, meta_token, ig_page_id, pipeline_id):
        self.id = id
        self.username = username
        self.password = password
        self.meta_token = meta_token
        self.ig_page_id = ig_page_id
        self.pipeline_id = pipeline_id

@login_manager.user_loader
def load_user(user_id):
    conn = get_db()
    curr = conn.cursor()
    curr.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    res = curr.fetchone()
    conn.close()
    
    if res:
        token = res['meta_token'] if 'meta_token' in res.keys() else None
        page_id = res['ig_page_id'] if 'ig_page_id' in res.keys() else None
        return User(res['id'], res['username'], res['password'], token, page_id, res['pipeline_id'])
    return None

def format_relative_time(dt_str):
    if not dt_str:
        return ""
    try:
        if isinstance(dt_str, str):
            dt = datetime.fromisoformat(dt_str.replace('T', ' ').split('+')[0])
        else:
            dt = dt_str
        diff = datetime.now() - dt
        if diff.days == 0:
            return "Hoje"
        if diff.days == 1:
            return "Ontem"
        return f"Há {diff.days}d"
    except:
        return "Recente"

def worker_fetch_leads(user_id, meta_token, ig_page_id):
    USER_CACHES[user_id] = {'loading': True, 'data': []}
    if not meta_token or not ig_page_id:
        USER_CACHES[user_id] = {'loading': False, 'data': [], 'error': 'Token ou ID da Página não configurados.'}
        return
        
    try:
        url = f"{GRAPH_URL}/{ig_page_id}/conversations"
        params = {'fields': 'id,updated_time,messages{message,from,created_time},participants', 'access_token': meta_token, 'limit': 20}
        resp = requests.get(url, params=params)
        data = resp.json()
        
        if 'error' in data:
            raise Exception(data['error']['message'])
        
        conversations = data.get('data', [])
        results = []
        conn_notif = get_db()
        
        for conv in conversations:
            participants = conv.get('participants', {}).get('data', [])
            client = participants[0] if participants else None
            if not client:
                continue
                
            last_msg_data = conv.get('messages', {}).get('data', [{}])[0]
            msg_text = last_msg_data.get('message', 'Mídia/Anexo')
            username = client.get('username', client.get('name', 'Desconhecido'))
            
            lead_db = conn_notif.execute("SELECT last_msg, unread_count FROM leads WHERE username=?", (username,)).fetchone()
            
            if lead_db and lead_db['last_msg'] != msg_text:
                new_count = (lead_db['unread_count'] or 0) + 1
                conn_notif.execute("UPDATE leads SET last_msg=?, unread_count=? WHERE username=?", (msg_text, new_count, username))
            
            results.append({
                "name": client.get('name', username), 
                "username": username, 
                "profile_pic": "", 
                "last_msg": msg_text, 
                "time_ago": format_relative_time(conv.get('updated_time')), 
                "id": conv.get('id')
            })
        
        conn_notif.commit()
        conn_notif.close()
        USER_CACHES[user_id] = {'loading': False, 'data': results}
        
    except Exception as e:
        print(f"ERRO FETCH: {e}")
        USER_CACHES[user_id] = {'loading': False, 'data': [], 'error': str(e)}

# ==============================================================================
# FRONTEND TEMPLATE
# ==============================================================================
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="pt-br" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KeepMedica CRM</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: { 
                extend: {
                    colors: {
                        brand: '#206aba',
                    }
                } 
            }
        }
    </script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    
    <style type="text/tailwindcss">
        body { font-family: 'Inter', system-ui, sans-serif; @apply bg-blue-50/30 dark:bg-[#0A0A0A] dark:text-slate-100; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .kanban-col { min-height: 75vh; padding-bottom: 50px; }
        .drag-over { background-color: #eff6ff; border: 2px dashed #206aba; }
        
        .chat-bg { background-color: #efeae2; background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); }
        .dark .chat-bg { background-color: #0f172a; background-image: none; }

        .msg-bubble { max-width: 75%; padding: 8px 12px; border-radius: 8px; font-size: 14px; position: relative; box-shadow: 0 1px 2px rgba(0,0,0,0.1); margin-bottom: 4px; }
        .msg-me { @apply bg-[#d9fdd3] dark:bg-brand/20 dark:text-white; align-self: flex-end; border-top-right-radius: 0; }
        .msg-them { @apply bg-white dark:bg-slate-700 dark:text-white; align-self: flex-start; border-top-left-radius: 0; }
        
        .loader { border: 3px solid #f3f3f3; border-top: 3px solid #206aba; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        .nav-btn-custom {
            @apply flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl transition-all duration-200 transform active:scale-95 border shadow-sm select-none cursor-pointer;
        }
        .nav-btn-custom.inactive { @apply bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:text-white hover:shadow; }
        .nav-btn-custom.active-leads { @apply bg-brand/10 border-brand/30 text-brand dark:bg-brand/20 dark:border-brand/50 dark:text-brand shadow-inner ring-1 ring-brand/20 dark:ring-brand/40; }
        
        .nav-scroll-btn {
            position: fixed; top: 55%; transform: translateY(-50%); width: 50px; height: 50px;
            background: rgba(32, 106, 186, 0.85); color: white; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.3s ease; border: 2px solid white;
        }
        .nav-scroll-btn:hover { background: #206aba; transform: translateY(-50%) scale(1.1); }
        #btn-left { left: 20px; }
        #btn-right { right: 20px; }

        #notif-portal {
            display: none; position: absolute; top: 60px; right: 210px; width: 350px; max-height: 500px;
            @apply bg-white dark:bg-slate-800 border dark:border-slate-700;
            border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15);
            z-index: 1000; overflow: hidden;
        }
        .notif-badge {
            position: absolute; top: -5px; right: -5px; background: #ef4444; color: white;
            font-size: 10px; font-weight: bold; min-width: 18px; height: 18px;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            border: 2px solid white;
        }

        #profile-menu, #main-menu {
            display: none; position: absolute; @apply bg-white dark:bg-slate-800 border dark:border-slate-700; border-radius: 20px; 
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); z-index: 1001; 
            padding: 16px 0; animation: fadeInMenu 0.2s ease-out;
        }
        #profile-menu { top: 65px; right: 20px; width: 320px; }
        #main-menu { top: 65px; left: 20px; width: 300px; }

        @keyframes fadeInMenu { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        
        .menu-header { @apply flex flex-col items-center px-6 py-4 border-b border-gray-100 dark:border-slate-700 mb-3 text-center; }
        .menu-item { @apply flex items-center justify-start gap-4 px-6 py-3 text-sm text-gray-700 dark:text-slate-300 hover:bg-brand/10 dark:hover:bg-slate-700 hover:text-brand transition-all duration-200 cursor-pointer mx-2 rounded-xl; }
        #profile-menu .menu-item { justify-content: center; }
        .menu-item-logout { @apply flex items-center justify-center gap-3 px-4 py-4 text-sm text-red-500 font-bold transition-all duration-200 cursor-pointer border-t border-gray-100 dark:border-slate-700 mt-2 bg-white dark:bg-slate-800; }
        .menu-item-logout:hover { color: #b91c1c; background-color: white !important; @apply dark:bg-slate-700; }

        #activity-panel {
            position: fixed; top: 0; right: 0; width: 400px; height: 100vh;
            @apply bg-white dark:bg-slate-800; z-index: 2000; box-shadow: -5px 0 25px rgba(0,0,0,0.1);
            transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex; flex-direction: column;
        }
        #activity-panel.open { transform: translateX(0); }
        .activity-item::before { content: ''; position: absolute; left: 19px; top: 40px; bottom: -20px; width: 2px; @apply bg-gray-200 dark:bg-slate-700; z-index: 0; }
        .activity-item:last-child::before { display: none; }

        .tab-btn { @apply text-gray-600 dark:text-slate-400 font-medium px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700 transition w-full text-left flex items-center gap-3; }
        .tab-btn.active { @apply bg-brand/10 dark:bg-slate-700 text-brand dark:text-brand font-bold; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .dash-card { @apply rounded-2xl p-6 text-white shadow-lg relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-default; }
        .dash-card i { @apply absolute right-4 top-1/2 transform -translate-y-1/2 text-6xl opacity-20; }
        
        .golden-btn {
            @apply flex flex-col items-center justify-center w-80 h-full rounded-xl border-2 border-dashed border-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-all cursor-pointer flex-shrink-0 opacity-80 hover:opacity-100;
            animation: goldenPulse 2s infinite;
        }
        @keyframes goldenPulse {
            0% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(250, 204, 21, 0); }
            100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
        }

        .card-menu {
            display: none; 
            position: absolute; 
            top: 35px; right: 10px; 
            @apply bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600;
            border-radius: 8px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
            z-index: 50; 
            min-width: 120px;
            overflow: hidden;
        }
        .card-menu-item {
            @apply flex items-center gap-2 px-4 py-2 text-xs text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer transition-colors;
        }
        .card-menu-item:hover { color: #206aba; }
        .card-menu-item.danger:hover { color: #ef4444; background: #fef2f2; @apply dark:bg-red-900/30; }

        .new-hub-card {
            @apply bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 border border-transparent cursor-pointer relative overflow-hidden h-full min-h-[16rem] flex flex-col justify-between;
        }
        .new-hub-card:hover { transform: translateY(-5px); }
        
        .card-top-icon {
            @apply w-12 h-12 flex items-center justify-center text-2xl mb-4 transition-transform rounded-lg;
        }
        .new-hub-card:hover .card-top-icon { transform: scale(1.1); }
        
        .card-title { @apply text-lg font-bold text-gray-800 dark:text-white mb-2; }
        .card-desc { @apply text-xs text-gray-500 dark:text-slate-400 font-medium leading-relaxed; }
        .card-link { @apply text-sm font-bold mt-4 inline-flex items-center gap-1 transition-colors; }
        
        .card-green { border-top: 4px solid #4ade80; }
        .card-green .card-link { color: #22c55e; }
        .card-green:hover { border-color: #22c55e; }

        .card-orange { border-top: 4px solid #fb923c; }
        .card-orange .card-link { color: #f97316; }
        .card-orange:hover { border-color: #f97316; }

        .card-cyan { border-top: 4px solid #22d3ee; }
        .card-cyan .card-link { color: #06b6d4; }
        .card-cyan:hover { border-color: #06b6d4; }

        .card-purple { border-top: 4px solid #8b5cf6; }
        .card-purple .card-link { color: #8b5cf6; }
        .card-purple:hover { border-color: #8b5cf6; }

        .card-lime { border-top: 4px solid #a3e635; }
        .card-lime .card-link { color: #84cc16; }
        .card-lime:hover { border-color: #84cc16; }

        .card-blue { border-top: 4px solid #206aba; }
        .card-blue .card-link { color: #206aba; }
        .card-blue:hover { border-color: #206aba; }
        
        /* ESTILOS DA AGENDA */
        .calendar-cell { @apply h-10 border-b border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition relative hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer text-[10px] p-1; }
        .time-cell { @apply h-10 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-xs text-gray-500 dark:text-slate-400 font-medium flex items-center justify-center sticky left-0 z-10; }
        .doctor-header { @apply h-12 flex-1 border-r border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-900 text-xs font-bold text-gray-700 dark:text-slate-300 flex items-center justify-center px-2 text-center sticky top-0 z-20 relative overflow-hidden; }
        
        .resizer {
            position: absolute; right: 0; top: 0; bottom: 0; width: 5px;
            cursor: col-resize; z-index: 50; transition: background 0.2s;
        }
        .resizer:hover, .resizing { background: #206aba; }

        .mini-cal-day { @apply w-8 h-8 flex items-center justify-center text-xs rounded-full hover:bg-gray-200 dark:hover:bg-slate-600 cursor-pointer transition; }
        .mini-cal-day.active { @apply bg-brand text-white font-bold; }

        /* Status Badges */
        .status-badge { @apply px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider; }
        .status-pendente { @apply bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400; }
        .status-aprovado { @apply bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400; }
        .status-recusado { @apply bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden text-gray-800 dark:text-slate-100 bg-[#f8faff] dark:bg-[#0A0A0A]">

    {% if not current_user.is_authenticated %}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-100 dark:bg-[#0A0A0A]">
        <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl w-96 text-center border border-gray-200 dark:border-slate-700">
            <div class="w-16 h-16 bg-brand rounded-xl mx-auto flex items-center justify-center text-white text-3xl font-bold mb-6 shadow-lg shadow-brand/30">K</div>
            <h2 class="text-2xl font-bold text-gray-800 dark:text-white mb-6"><span class="text-brand">Keep</span>Medica</h2>
            
            <form action="/login" method="POST" class="space-y-4">
                <input name="username" class="w-full p-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-brand outline-none transition" placeholder="Usuário" required>
                <input name="password" type="password" class="w-full p-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-brand outline-none transition" placeholder="Senha" required>
                <button type="submit" class="w-full py-3 bg-brand hover:opacity-90 text-white font-bold rounded-lg transition shadow-md">Entrar</button>
            </form>
            <p class="mt-8 text-xs text-gray-400">Administrador: Pressione <b>A+D+M</b> (3s) | Senha: 2026</p>
        </div>
    </div>
    
    <div id="modal-admin-login" class="fixed inset-0 z-[60] bg-black/90 hidden flex items-center justify-center backdrop-blur-sm transition-all duration-300">
        <div class="text-center transform scale-100">
            <i class="fas fa-user-shield text-6xl text-green-500 mb-4 animate-pulse"></i>
            <h2 class="text-2xl text-white font-mono mb-6 tracking-widest">PAINEL ADMINISTRATIVO</h2>
            <input id="admin-pwd" type="password" class="bg-gray-800 text-white border border-green-500 p-4 rounded text-center w-64 text-xl outline-none mb-6 focus:ring-2 focus:ring-green-500 transition" placeholder="SENHA MESTRA">
            <div class="flex gap-3 justify-center">
                <button onclick="authAdmin()" class="bg-green-600 hover:bg-green-700 text-white px-8 py-2 rounded font-bold transition shadow-lg shadow-green-900/50">ACESSAR</button>
                <button onclick="document.getElementById('modal-admin-login').classList.add('hidden')" class="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded transition">SAIR</button>
            </div>
        </div>
    </div>

    <div id="modal-admin-panel" class="fixed inset-0 z-[70] bg-gray-100 dark:bg-[#0A0A0A] hidden flex items-center justify-center">
        <div class="bg-white dark:bg-slate-800 w-[1000px] h-[750px] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up">
            <div class="bg-gray-900 text-white p-5 flex justify-between items-center shadow-md z-10">
                <h3 class="font-bold text-lg flex items-center gap-2"><i class="fas fa-cogs"></i> Configuração do Sistema</h3>
                <button onclick="location.reload()" class="text-gray-400 hover:text-white text-2xl transition">&times;</button>
            </div>
            
            <div class="flex flex-1 overflow-hidden">
                <aside class="w-64 bg-gray-50 dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 p-4 space-y-2">
                    <button onclick="setTab('users')" class="w-full text-left p-3 rounded-lg hover:bg-white dark:hover:bg-slate-800 hover:shadow transition font-medium text-gray-700 dark:text-slate-300 flex items-center gap-2"><i class="fas fa-users text-brand"></i> Usuários</button>
                    <button onclick="setTab('pipelines')" class="w-full text-left p-3 rounded-lg hover:bg-white dark:hover:bg-slate-800 hover:shadow transition font-medium text-gray-700 dark:text-slate-300 flex items-center gap-2"><i class="fas fa-project-diagram text-purple-500"></i> Pipelines</button>
                </aside>
                <main class="flex-1 p-8 overflow-y-auto bg-white dark:bg-slate-800">
                    <div id="tab-users">
                        <h2 class="text-2xl font-bold mb-6 text-gray-800 dark:text-white border-b dark:border-slate-700 pb-2">Gerenciar Usuários</h2>
                        <div class="bg-brand/10 dark:bg-slate-700 p-5 rounded-xl border border-brand/20 dark:border-slate-600 mb-8">
                            <h4 class="text-sm font-bold text-brand dark:text-brand mb-3 uppercase tracking-wide">Criar Novo Acesso</h4>
                            <div class="flex gap-3">
                                <input id="new-u" placeholder="Nome de Usuário" class="border border-brand/30 dark:border-slate-500 dark:bg-slate-800 dark:text-white p-2.5 rounded-lg text-sm flex-1 focus:ring-2 focus:ring-brand outline-none">
                                <input id="new-p" placeholder="Senha" class="border border-brand/30 dark:border-slate-500 dark:bg-slate-800 dark:text-white p-2.5 rounded-lg text-sm flex-1 focus:ring-2 focus:ring-brand outline-none">
                                <button onclick="admCreateUser()" class="bg-brand hover:opacity-90 text-white px-6 rounded-lg text-sm font-bold shadow-md transition">CRIAR</button>
                            </div>
                        </div>
                        <div id="list-users" class="space-y-4"></div>
                    </div>
                    <div id="tab-pipelines" class="hidden">
                        <h2 class="text-2xl font-bold mb-6 text-gray-800 dark:text-white border-b dark:border-slate-700 pb-2">Pipelines & Etapas</h2>
                        <div id="list-pipelines" class="space-y-8"></div>
                    </div>
                </main>
            </div>
        </div>
    </div>

    {% else %}
    <header class="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 h-16 flex items-center justify-between px-6 z-20 shrink-0 shadow-sm relative">
        <div class="flex items-center gap-8 h-full">
            <div class="flex items-center gap-3 cursor-pointer hover:opacity-80 transition group relative" onclick="viewApp('hub')">
                <div class="w-9 h-9 bg-brand rounded-lg flex items-center justify-center text-white font-bold text-xl shadow transform group-active:scale-95 transition-transform">K</div>
                <div class="leading-tight">
                    <h1 class="font-bold text-gray-800 dark:text-white text-lg"><span class="text-brand">Keep</span>Medica</h1>
                    <span class="text-[10px] text-gray-500 dark:text-slate-400 font-medium uppercase tracking-wider bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">V.1.0</span>
                </div>
            </div>
        </div>

        <div class="flex items-center gap-6">
            <button onclick="toggleTheme()" class="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-yellow-400 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-600 transition focus:outline-none">
                <i class="fas fa-moon dark:hidden"></i>
                <i class="fas fa-sun hidden dark:block"></i>
            </button>

            <div class="relative">
                <button onclick="toggleNotifications()" class="text-gray-500 dark:text-slate-400 hover:text-brand transition relative">
                    <i class="fas fa-bell text-xl"></i>
                    <div id="notif-badge" class="notif-badge hidden">0</div>
                </button>
                <div id="notif-portal">
                    <div class="bg-white dark:bg-slate-800 h-full flex flex-col">
                        <div class="p-4 border-b dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-900">
                            <span class="font-bold text-gray-700 dark:text-white">Notificações</span>
                            <button onclick="clearAllNotifs()" class="text-xs text-brand hover:underline">Limpar todas</button>
                        </div>
                        <div id="notif-list" class="flex-1 overflow-y-auto">
                            <p class="text-center text-gray-400 text-sm py-10">Nenhuma notificação nova.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="relative">
                <div onclick="toggleProfileMenu()" class="flex items-center gap-3 text-sm text-gray-700 dark:text-slate-200 bg-gray-50 dark:bg-slate-700 px-4 py-2 rounded-full border border-gray-200 dark:border-slate-600 shadow-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600 transition active:scale-95">
                    <div class="relative">
                        <i class="fas fa-users-cog text-xl text-gray-400 dark:text-slate-400"></i>
                        <span class="absolute bottom-0 right-0 w-3 h-3 {{ 'bg-green-500' if current_user.meta_token else 'bg-red-500 animate-pulse' }} border-2 border-white dark:border-slate-700 rounded-full"></span>
                    </div>
                    <span class="font-medium">Usuários</span>
                </div>
                <div id="profile-menu">
                    <div class="menu-header">
                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Conta Atual</p>
                        <div class="w-16 h-16 rounded-full bg-brand flex items-center justify-center text-white font-bold text-2xl shadow-lg mb-3 border-4 border-white dark:border-slate-700">
                            {{ current_user.username[0]|upper }}
                        </div>
                        <h4 class="text-base font-bold text-gray-800 dark:text-white truncate w-full">{{ current_user.username }}</h4>
                        <span class="text-xs text-green-500 font-medium flex items-center justify-center gap-1 mt-1">
                            <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Online
                        </span>
                    </div>
                    <div class="py-1">
                        <div class="menu-item group" onclick="openProfileModal()">
                            <i class="far fa-user w-5 group-hover:scale-110 group-hover:rotate-6 transition-transform text-brand"></i> 
                            Configurações da Conta
                            <span class="ml-auto opacity-0 group-hover:opacity-100 text-brand text-[10px] font-bold transition-opacity">VER</span>
                        </div>
                        <a href="/logout" class="menu-item-logout"><i class="fas fa-sign-out-alt"></i> Sair do sistema</a>
                    </div>
                </div>
            </div>
            
            <button onclick="openInstaModal()" class="bg-gradient-to-r from-pink-600 to-orange-500 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-md hover:shadow-lg hover:opacity-95 transition transform active:scale-95 flex items-center gap-2">
                <i class="fab fa-instagram text-lg"></i> Conectar
            </button>
        </div>
    </header>

    <div class="flex-1 overflow-hidden relative">
        
        <div id="view-hub" class="absolute inset-0 overflow-y-auto p-6 transition-opacity duration-300">
            <div class="max-w-full mx-auto px-6">
                <div class="text-center mb-10 mt-8">
                    <h2 class="text-4xl font-extrabold text-slate-800 dark:text-white mb-3">Painel de Controle</h2>
                    <p class="text-slate-500 dark:text-slate-400 max-w-3xl mx-auto text-lg">A primeira plataforma de Gestão de Mensagens para Clínicas. Centralize WhatsApp e Instagram em um só lugar. Automatize o atendimento, aumente suas vendas e transforme conversas em pacientes fidelizados.</p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6">
                    
                    <div onclick="viewApp('kanban')" class="new-hub-card card-orange group">
                        <div>
                            <div class="card-top-icon bg-orange-100 text-orange-500 dark:bg-orange-900/30">
                                <i class="fas fa-comments"></i>
                            </div>
                            <h3 class="card-title">Leads</h3>
                            <p class="card-desc">Gerencie seus pacientes via pipeline visual.</p>
                        </div>
                        <span class="card-link">Acessar <i class="fas fa-chevron-right text-xs"></i></span>
                    </div>

                    <div onclick="viewApp('chat')" class="new-hub-card card-green group">
                        <div>
                            <div class="card-top-icon bg-green-100 text-green-600 dark:bg-green-900/30">
                                <i class="fab fa-whatsapp"></i>
                            </div>
                            <h3 class="card-title">Chat</h3>
                            <p class="card-desc">Centralize redes e responda rápido.</p>
                        </div>
                        <span class="card-link">Acessar <i class="fas fa-chevron-right text-xs"></i></span>
                    </div>
                    
                    <div onclick="viewApp('agenda')" class="new-hub-card card-cyan group">
                        <div>
                            <div class="card-top-icon bg-cyan-100 text-cyan-500 dark:bg-cyan-900/30">
                                <i class="far fa-calendar-alt"></i>
                            </div>
                            <h3 class="card-title">Agenda</h3>
                            <p class="card-desc">Visualize e organize a agenda médica de forma integrada.</p>
                        </div>
                        <span class="card-link">Acessar <i class="fas fa-chevron-right text-xs"></i></span>
                    </div>

                    <div onclick="viewApp('quality')" class="new-hub-card card-lime group">
                        <div>
                            <div class="card-top-icon bg-lime-100 text-lime-600 dark:bg-lime-900/30">
                                <i class="fas fa-chart-pie"></i>
                            </div>
                            <h3 class="card-title">Relatórios</h3>
                            <p class="card-desc">Análise de leads, orçamentos e agendamentos.</p>
                        </div>
                        <span class="card-link">Acessar <i class="fas fa-chevron-right text-xs"></i></span>
                    </div>

                    <div onclick="viewApp('finance')" class="new-hub-card card-purple group">
                        <div>
                            <div class="card-top-icon bg-purple-100 text-purple-600 dark:bg-purple-900/30">
                                <i class="fas fa-wallet"></i>
                            </div>
                            <h3 class="card-title">Financeiro</h3>
                            <p class="card-desc">Controle de orçamentos, faturamento e fluxo de caixa.</p>
                        </div>
                        <span class="card-link">Acessar <i class="fas fa-chevron-right text-xs"></i></span>
                    </div>

                    <div onclick="openProfileModal()" class="new-hub-card card-blue group">
                        <div>
                            <div class="card-top-icon bg-brand/10 text-brand dark:bg-brand/20">
                                <i class="fas fa-user-shield"></i>
                            </div>
                            <h3 class="card-title">Usuários</h3>
                            <p class="card-desc">Gerencie permissões e acessos.</p>
                        </div>
                        <span class="card-link">Acessar <i class="fas fa-chevron-right text-xs"></i></span>
                    </div>

                </div>
            </div>
        </div>

        <div id="view-agenda" class="absolute inset-0 flex bg-white dark:bg-slate-900 hidden opacity-0 transition-opacity duration-300">
            <div class="w-80 border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col p-6">
                <div class="mb-6 flex justify-between items-center">
                    <h2 id="current-month-year" class="text-lg font-bold text-gray-800 dark:text-white uppercase tracking-widest">JUNHO 2026</h2>
                    <div class="flex gap-2">
                        <button onclick="openDoctorsModal()" class="text-gray-400 hover:text-brand mr-2" title="Gerenciar Médicos"><i class="fas fa-cog"></i></button>
                        <button onclick="changeMonth(-1)" class="text-gray-400 hover:text-brand"><i class="fas fa-chevron-left"></i></button>
                        <button onclick="changeMonth(1)" class="text-gray-400 hover:text-brand"><i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
                <div class="grid grid-cols-7 gap-2 mb-2 text-center">
                    <span class="text-xs font-bold text-gray-400">D</span>
                    <span class="text-xs font-bold text-gray-400">S</span>
                    <span class="text-xs font-bold text-gray-400">T</span>
                    <span class="text-xs font-bold text-gray-400">Q</span>
                    <span class="text-xs font-bold text-gray-400">Q</span>
                    <span class="text-xs font-bold text-gray-400">S</span>
                    <span class="text-xs font-bold text-gray-400">S</span>
                </div>
                <div id="mini-calendar-grid" class="grid grid-cols-7 gap-2 text-center">
                    </div>
                <div class="mt-auto text-right text-[10px] text-gray-400 italic">atualizado agora</div>
            </div>
            
            <div class="flex-1 flex flex-col overflow-hidden relative">
                <div class="flex border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-x-auto scrollbar-hide">
                    <div class="min-w-[60px] border-r border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 sticky left-0 z-30"></div> 
                    <div class="flex w-full" id="doctors-header">
                        </div>
                </div>
                
                <div class="flex-1 overflow-auto relative">
                    <div class="flex w-full">
                        <div class="min-w-[60px] flex flex-col border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 sticky left-0 z-20">
                             {% for hour in range(8, 19) %}
                                {% for minute in ['00', '15', '30', '45'] %}
                                    <div class="time-cell">{{ "%02d:%s" | format(hour, minute) }}</div>
                                {% endfor %}
                             {% endfor %}
                        </div>
                        
                        <div class="flex w-full" id="agenda-grid-body">
                             </div>
                    </div>
                </div>
            </div>
        </div>
        <button onclick="scrollKanban(-400)" id="btn-left" class="nav-scroll-btn" style="display:none;"><i class="fas fa-chevron-left"></i></button>
        <button onclick="scrollKanban(400)" id="btn-right" class="nav-scroll-btn" style="display:none;"><i class="fas fa-chevron-right"></i></button>

        <div id="view-kanban" class="absolute inset-0 overflow-x-auto p-6 flex gap-5 items-start transition-opacity duration-300 hidden opacity-0">
            {% for stage in stages %}
            <div class="flex-shrink-0 w-80 flex flex-col bg-gray-50/80 dark:bg-slate-800/80 rounded-xl border border-gray-200 dark:border-slate-700 max-h-full shadow-sm">
                <div class="p-4 bg-white dark:bg-slate-800 rounded-t-xl border-b border-gray-200 dark:border-slate-700 flex justify-between items-center sticky top-0 z-10 border-t-4 shadow-sm" style="border-top-color: {{ stage['color'] }}">
                    <h3 class="font-bold text-xs text-gray-700 dark:text-slate-300 uppercase tracking-wide">{{ stage['name'] }}</h3>
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-2.5 py-1 rounded-full border border-gray-200 dark:border-slate-600">{{ leads[stage['name']]|length }}</span>
                        <button onclick="deleteColumn({{ stage['id'] }})" class="text-gray-300 dark:text-slate-600 hover:text-red-500 transition ml-1 p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="Excluir Coluna">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                </div>
                <div class="p-3 flex-1 overflow-y-auto kanban-col scrollbar-hide space-y-3" 
                     ondrop="drop(event, '{{ stage['name'] }}')" 
                     ondragover="allowDrop(event)">
                    {% for lead in leads[stage['name']] %}
                    <div draggable="true" ondragstart="drag(event, '{{ lead['id'] }}')" 
                         class="bg-white dark:bg-slate-700 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-slate-600 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-brand dark:hover:border-brand transition-all group relative">
                        <div class="absolute top-3 right-3 z-20">
                            <button onclick="toggleCardMenu(event, {{ lead['id'] }})" class="text-gray-300 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 p-1 transition">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div id="card-menu-{{ lead['id'] }}" class="card-menu">
                                <div onclick="openEditLead({{ lead['id'] }}, '{{ lead['name'] }}', '{{ lead['value'] }}')" class="card-menu-item">
                                    <i class="fas fa-pencil-alt text-brand w-4"></i> Editar
                                </div>
                                <div onclick="deleteLead({{ lead['id'] }})" class="card-menu-item danger">
                                    <i class="fas fa-trash-alt text-red-500 w-4"></i> Excluir
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3 mb-3 pr-6">
                            <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-600 flex-shrink-0 overflow-hidden border border-gray-200 dark:border-slate-500 shadow-sm">
                                <img src="{{ lead['profile_pic'] }}" onerror="this.src='https://ui-avatars.com/api/?name={{ lead['name'] }}&background=random'" class="w-full h-full object-cover">
                            </div>
                            <div class="overflow-hidden">
                                <h4 class="font-bold text-sm text-gray-800 dark:text-slate-100 truncate">{{ lead['name'] }}</h4>
                                <a href="https://instagram.com/{{ lead['username'] }}" target="_blank" class="text-xs text-brand hover:underline flex items-center gap-1">
                                    <i class="fab fa-instagram"></i> {{ lead['username'] }}
                                </a>
                                {% if lead['value'] > 0 %}
                                <span class="text-[10px] text-green-600 dark:text-green-400 font-bold">R$ {{ lead['value'] }}</span>
                                {% endif %}
                            </div>
                        </div>
                        {% if lead['last_msg'] %}
                        <div class="bg-gray-50 dark:bg-slate-800 p-2.5 rounded-lg text-xs text-gray-600 dark:text-slate-400 italic mb-3 line-clamp-2 border border-gray-100 dark:border-slate-600 relative">
                            <i class="fas fa-quote-left text-gray-300 dark:text-slate-600 absolute -top-1 -left-1 text-[10px]"></i>
                            {{ lead['last_msg'] }}
                        </div>
                        {% endif %}
                        <div class="flex justify-between items-center border-t border-gray-100 dark:border-slate-600 pt-2 mt-1">
                            <span class="text-[10px] text-gray-400 dark:text-slate-500 font-medium flex items-center gap-1.5"><i class="far fa-clock"></i> {{ lead['last_interaction'] or 'Recente' }}</span>
                            <div class="flex items-center gap-2">
                                {% if lead['unread_count'] > 0 %}
                                <span class="bg-red-500 text-white text-[10px] font-bold px-2 rounded-full animate-pulse">{{ lead['unread_count'] }}</span>
                                {% endif %}
                            </div>
                        </div>
                    </div>
                    {% endfor %}
                </div>
            </div>
            {% endfor %}
            <div onclick="addKanbanColumn()" class="golden-btn group">
                <div class="w-16 h-16 rounded-full bg-brand flex items-center justify-center text-white text-3xl shadow-lg group-hover:scale-110 transition-transform">
                    <i class="fas fa-plus"></i>
                </div>
                <span class="mt-4 font-bold text-brand uppercase tracking-widest text-sm">Adicionar Coluna</span>
            </div>
        </div>

        <div id="view-chat" class="absolute inset-0 flex bg-white dark:bg-slate-900 hidden opacity-0 transition-opacity duration-300">
            <div class="w-1/3 max-w-sm border-r border-gray-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800 z-10 shadow-lg">
                <div class="p-5 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="font-bold text-gray-800 dark:text-white text-lg">Conversas</h2>
                        <button onclick="loadThreads()" class="w-8 h-8 rounded-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:text-brand hover:border-brand flex items-center justify-center transition shadow-sm"><i class="fas fa-sync-alt"></i></button>
                    </div>
                    <div class="relative">
                        <select id="chat-filter" onchange="applyFilter()" class="w-full p-2.5 pl-3 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer font-medium text-gray-700 shadow-sm">
                            <option value="ALL">📂 Todas as Conversas</option>
                            <option value="NONE">✨ Não Salvos (Novos)</option>
                            <optgroup label="Filtrar por Etapa">
                                {% for stage in stages %}
                                <option value="{{ stage['name'] }}">🔹 {{ stage['name'] }}</option>
                                {% endfor %}
                            </optgroup>
                        </select>
                        <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500"><i class="fas fa-chevron-down text-xs"></i></div>
                    </div>
                </div>
                <div id="chat-list" class="flex-1 overflow-y-auto bg-white dark:bg-slate-800">
                    <div class="flex flex-col items-center justify-center h-48 text-gray-400 space-y-2"><div class="loader"></div><p class="text-sm">Sincronizando...</p></div>
                </div>
            </div>
            <div class="flex-1 flex flex-col bg-[#efeae2] relative chat-bg">
                <div id="chat-header" class="h-16 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center px-6 justify-between hidden shadow-sm z-20">
                    <div class="flex items-center gap-4">
                        <img id="chat-pic" src="" class="w-10 h-10 rounded-full border border-gray-200 dark:border-slate-600 bg-gray-100 dark:bg-slate-700 object-cover">
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 id="chat-name" class="font-bold text-gray-800 dark:text-white text-sm">Nome</h3>
                                <span id="chat-badge" class="hidden text-[10px] px-2 py-0.5 rounded text-white font-bold uppercase tracking-wider shadow-sm transition-all"></span>
                            </div>
                            <p id="chat-user" class="text-xs text-gray-500 dark:text-slate-400 font-medium">@usuario</p>
                        </div>
                    </div>
                    <input type="hidden" id="chat-tid">
                </div>
                <div id="chat-msgs" class="flex-1 overflow-y-auto p-6 flex flex-col gap-2">
                    <div class="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
                        <div class="w-32 h-32 bg-gray-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-gray-300 dark:text-slate-500 mb-2"><i class="fas fa-comments text-6xl"></i></div>
                        <p class="font-medium text-gray-500 dark:text-slate-400">Selecione uma conversa para iniciar o atendimento.</p>
                    </div>
                </div>
                <div id="chat-input" class="p-4 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 hidden">
                    <form onsubmit="sendMsg(event)" class="flex gap-3 items-end max-w-4xl mx-auto">
                        <div class="flex-1 relative">
                            <textarea id="msg-txt" rows="1" class="w-full p-3 pl-4 border border-gray-300 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-brand outline-none resize-none bg-gray-50 dark:bg-slate-700 text-gray-700 dark:text-white shadow-inner" placeholder="Digite sua mensagem..." onkeydown="if(event.keyCode == 13 && !event.shiftKey) { event.preventDefault(); sendMsg(event); }"></textarea>
                        </div>
                        <button type="submit" class="bg-brand text-white w-12 h-12 rounded-full hover:opacity-90 transition shadow-lg flex items-center justify-center transform hover:scale-105 active:scale-95"><i class="fas fa-paper-plane"></i></button>
                    </form>
                </div>
            </div>
        </div>

        <div id="view-finance" class="absolute inset-0 overflow-y-auto p-8 hidden bg-gray-50 dark:bg-[#0A0A0A] transition-opacity duration-300 opacity-0">
            <div class="max-w-6xl mx-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-3xl font-bold text-gray-800 dark:text-white">Financeiro & Orçamentos</h2>
                    <button onclick="openBudgetModal()" class="bg-brand text-white px-5 py-2 rounded-lg font-bold shadow-md hover:opacity-90 transition flex items-center gap-2"><i class="fas fa-plus"></i> Novo Orçamento</button>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 relative overflow-hidden">
                        <div class="absolute right-0 top-0 bottom-0 w-2 bg-green-500"></div>
                        <div class="flex items-center gap-3 mb-2 text-gray-500 dark:text-slate-400">
                            <i class="fas fa-check-circle"></i>
                            <p class="text-sm font-bold uppercase tracking-wide">Faturamento (Aprovados)</p>
                        </div>
                        <h3 class="text-3xl font-bold text-gray-800 dark:text-white mt-1" id="fin-faturamento">R$ 0,00</h3>
                        <p class="text-xs text-green-500 mt-2 font-medium"><i class="fas fa-arrow-up"></i> Valor Realizado</p>
                    </div>
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 relative overflow-hidden">
                        <div class="absolute right-0 top-0 bottom-0 w-2 bg-orange-400"></div>
                        <div class="flex items-center gap-3 mb-2 text-gray-500 dark:text-slate-400">
                            <i class="fas fa-hourglass-half"></i>
                            <p class="text-sm font-bold uppercase tracking-wide">A Receber (Pendentes)</p>
                        </div>
                        <h3 class="text-3xl font-bold text-gray-800 dark:text-white mt-1" id="fin-pendente">R$ 0,00</h3>
                        <p class="text-xs text-orange-500 mt-2 font-medium"><i class="fas fa-clock"></i> Fluxo de Caixa Projetado</p>
                    </div>
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 relative overflow-hidden">
                        <div class="absolute right-0 top-0 bottom-0 w-2 bg-brand"></div>
                        <div class="flex items-center gap-3 mb-2 text-gray-500 dark:text-slate-400">
                            <i class="fas fa-file-invoice-dollar"></i>
                            <p class="text-sm font-bold uppercase tracking-wide">Total de Orçamentos</p>
                        </div>
                        <h3 class="text-3xl font-bold text-gray-800 dark:text-white mt-1" id="fin-total-qtd">0</h3>
                        <p class="text-xs text-blue-500 mt-2 font-medium" id="fin-aprovacao-rate">0% de Aprovação</p>
                    </div>
                </div>

                <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
                    <div class="p-5 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 flex justify-between items-center">
                        <h3 class="font-bold text-gray-800 dark:text-white flex items-center gap-2"><i class="fas fa-list text-brand"></i> Histórico de Lançamentos</h3>
                        <button onclick="loadFinanceData()" class="text-gray-400 hover:text-brand transition"><i class="fas fa-sync-alt"></i></button>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-sm">
                            <thead class="text-xs text-gray-500 dark:text-slate-400 uppercase bg-gray-50 dark:bg-slate-800/50">
                                <tr>
                                    <th class="px-6 py-4 font-bold">Data</th>
                                    <th class="px-6 py-4 font-bold">Paciente</th>
                                    <th class="px-6 py-4 font-bold">Contato / CPF</th>
                                    <th class="px-6 py-4 font-bold">Procedimento</th>
                                    <th class="px-6 py-4 font-bold text-right">Valor</th>
                                    <th class="px-6 py-4 font-bold text-center">Status</th>
                                    <th class="px-6 py-4 font-bold text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody id="fin-budgets-list" class="divide-y divide-gray-200 dark:divide-slate-700">
                                </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div id="view-quality" class="absolute inset-0 overflow-y-auto p-8 hidden bg-gray-50 dark:bg-[#0A0A0A] transition-opacity duration-300 opacity-0">
            <div class="max-w-6xl mx-auto">
                
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-3xl font-bold text-gray-800 dark:text-white">Dashboard Analítico</h2>
                    <div class="bg-white dark:bg-slate-800 rounded-lg p-1 flex shadow-sm border border-gray-200 dark:border-slate-700">
                        <button onclick="changeReportTab('contacts', this)" class="rep-tab-btn active px-4 py-2 text-sm rounded-md font-bold transition-all bg-brand text-white shadow">Contatos</button>
                        <button onclick="changeReportTab('budget', this)" class="rep-tab-btn px-4 py-2 text-sm rounded-md font-bold transition-all text-gray-500 dark:text-slate-400 hover:text-brand dark:hover:text-white">Orçamento</button>
                        <button onclick="changeReportTab('appointments', this)" class="rep-tab-btn px-4 py-2 text-sm rounded-md font-bold transition-all text-gray-500 dark:text-slate-400 hover:text-brand dark:hover:text-white">Agendamentos</button>
                    </div>
                </div>
                
                <div id="rep-top-banner" class="bg-brand rounded-2xl p-8 text-white shadow-lg mb-6 flex justify-between items-center relative overflow-hidden transition-colors duration-500">
                   <div class="z-10">
                       <p class="text-white/80 text-sm font-medium mb-1 tracking-wider uppercase" id="rep-highlight-title">Total de Novos Leads (7 dias)</p>
                       <h3 class="text-5xl font-extrabold flex items-center gap-3" id="rep-highlight-value">
                           <div class="loader hidden" style="border-color:#fff; border-top-color: transparent; width:30px; height:30px;"></div>
                           0
                       </h3>
                   </div>
                   <div class="z-10 flex gap-3">
                       <button onclick="loadDashboardData()" class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium backdrop-blur-sm transition"><i class="fas fa-sync-alt mr-2"></i> Atualizar</button>
                   </div>
                   <i id="rep-highlight-icon" class="fas fa-chart-line absolute -right-4 -bottom-4 text-8xl text-white opacity-10"></i>
                </div>
                
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div class="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 flex flex-col">
                        <div class="flex justify-between items-center mb-6">
                            <h4 class="font-bold text-gray-800 dark:text-white flex items-center gap-2"><i class="fas fa-chart-bar text-brand"></i> <span id="rep-chart-title">Evolução Diária</span></h4>
                            <span class="text-xs font-medium text-gray-400 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded">Últimos 7 dias</span>
                        </div>
                        <div class="relative flex-1 w-full min-h-[250px]">
                            <canvas id="mainChart"></canvas>
                        </div>
                    </div>
                    
                    <div class="flex flex-col gap-4">
                        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 flex-1 flex flex-col justify-center">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-bold text-gray-500 dark:text-slate-400" id="rep-side-1-title">Taxa de Conversão</span>
                                <div class="w-8 h-8 rounded-full bg-blue-100 text-brand dark:bg-blue-900/30 flex items-center justify-center"><i class="fas fa-percentage"></i></div>
                            </div>
                            <h4 class="text-3xl font-bold text-gray-800 dark:text-white" id="rep-side-1-val">0%</h4>
                            <span class="text-xs text-gray-400 font-medium mt-1" id="rep-side-1-desc">Leads movidos para Fechado</span>
                        </div>
                        <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 flex-1 flex flex-col justify-center">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-bold text-gray-500 dark:text-slate-400" id="rep-side-2-title">Em Negociação</span>
                                <div class="w-8 h-8 rounded-full bg-orange-100 text-orange-500 dark:bg-orange-900/30 flex items-center justify-center"><i class="fas fa-hourglass-half"></i></div>
                            </div>
                            <h4 class="text-3xl font-bold text-gray-800 dark:text-white" id="rep-side-2-val">0</h4>
                            <span class="text-xs text-gray-400 font-medium mt-1" id="rep-side-2-desc">Oportunidades ativas</span>
                        </div>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                     <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-5 flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-500 dark:text-slate-400 text-xl"><i class="fas fa-users"></i></div>
                        <div>
                            <h5 class="font-bold text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Total Geral da Base</h5>
                            <p class="text-xl font-bold text-gray-800 dark:text-white" id="rep-bot-1">0</p>
                        </div>
                     </div>
                     <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-5 flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-500 dark:text-slate-400 text-xl"><i class="fas fa-check-circle text-green-500"></i></div>
                        <div>
                            <h5 class="font-bold text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Orçamento Aprovado</h5>
                            <p class="text-xl font-bold text-gray-800 dark:text-white" id="rep-bot-2">R$ 0,00</p>
                        </div>
                     </div>
                     <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-5 flex items-center gap-4">
                        <div class="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-gray-500 dark:text-slate-400 text-xl"><i class="fas fa-calendar-check text-cyan-500"></i></div>
                        <div>
                            <h5 class="font-bold text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Consultas Hoje</h5>
                            <p class="text-xl font-bold text-gray-800 dark:text-white" id="rep-bot-3">0</p>
                        </div>
                     </div>
                </div>

            </div>
        </div>
    </div>
    
    <div id="activity-panel">
        <div class="p-5 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-900">
            <div class="flex items-center gap-3"><i class="fas fa-stream text-gray-500 dark:text-slate-400"></i><h3 class="font-bold text-gray-800 dark:text-white">Atividade</h3></div>
            <button onclick="toggleActivityPanel()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white transition text-2xl">&times;</button>
        </div>
        <div id="activity-list" class="flex-1 overflow-y-auto p-5 space-y-2">
            <div class="flex flex-col items-center justify-center h-full text-gray-400"><div class="loader mb-2"></div><p class="text-xs">Carregando histórico...</p></div>
        </div>
    </div>

    <div id="modal-new-budget" class="fixed inset-0 z-[100] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-[450px] overflow-hidden animate-fade-in-up">
            <div class="bg-purple-600 p-4 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm uppercase tracking-wide"><i class="fas fa-file-invoice-dollar mr-2"></i> Criar Orçamento</h3>
                <button onclick="closeBudgetModal()" class="hover:text-gray-200 text-xl">&times;</button>
            </div>
            <div class="p-6 space-y-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Nome do Paciente</label>
                    <input id="budget-patient" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                </div>
                <div class="flex gap-3">
                    <div class="flex-1">
                        <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">CPF</label>
                        <input id="budget-cpf" placeholder="000.000.000-00" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                    </div>
                    <div class="flex-1">
                        <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Número (WhatsApp)</label>
                        <input id="budget-phone" placeholder="(00) 00000-0000" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Procedimento</label>
                    <input id="budget-procedure" placeholder="Ex: Implante, Clareamento..." class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Valor (R$)</label>
                    <input id="budget-amount" type="number" step="0.01" min="0" placeholder="0.00" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none text-xl font-bold text-gray-800">
                </div>
                <button onclick="saveBudget()" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg shadow-md transition mt-4">SALVAR ORÇAMENTO</button>
            </div>
        </div>
    </div>

    <div id="modal-appointment" class="fixed inset-0 z-[100] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-96 overflow-hidden animate-fade-in-up">
            <div class="bg-cyan-600 p-4 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm uppercase tracking-wide">Novo Agendamento</h3>
                <button onclick="closeApptModal()" class="hover:text-gray-200 text-xl">&times;</button>
            </div>
            <div class="p-6 space-y-3">
                <input type="hidden" id="appt-date">
                <input type="hidden" id="appt-time">
                <input type="hidden" id="appt-doctor">
                <p id="appt-info" class="text-xs text-gray-500 dark:text-slate-400 mb-2 font-bold text-center border-b pb-2 dark:border-slate-600"></p>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Paciente</label>
                    <input id="appt-patient" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Procedimento</label>
                    <input id="appt-procedure" list="proc-list" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none">
                    <datalist id="proc-list"><option value="Consulta Inicial"><option value="Retorno"><option value="Exame"><option value="Cirurgia"></datalist>
                </div>
                <div class="flex gap-3">
                    <div class="flex-1">
                        <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Duração (min)</label>
                        <input type="number" id="appt-duration" value="30" min="5" step="5" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Cor</label>
                        <input type="color" id="appt-color" value="#206aba" class="h-9 w-12 border-none rounded cursor-pointer bg-transparent">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Nota/Observação</label>
                    <input id="appt-note" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none">
                </div>
                <button onclick="saveAppointment()" class="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 rounded shadow-md transition mt-2">CONFIRMAR</button>
            </div>
        </div>
    </div>

    <div id="modal-edit-appointment" class="fixed inset-0 z-[100] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-96 overflow-hidden animate-fade-in-up transform scale-100 transition-transform">
            <div class="bg-brand p-4 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm uppercase tracking-wide">Editar Consulta</h3>
                <button onclick="document.getElementById('modal-edit-appointment').classList.add('hidden')" class="hover:text-gray-200 text-xl">&times;</button>
            </div>
            <div class="p-6 space-y-4">
                <input type="hidden" id="edit-appt-id">
                <p id="edit-appt-info" class="text-xs text-gray-500 dark:text-slate-400 mb-2 font-bold text-center border-b pb-2 dark:border-slate-600"></p>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Nome do Paciente</label>
                    <input id="edit-appt-patient" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-brand outline-none">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Procedimento</label>
                    <input id="edit-appt-procedure" list="proc-list" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-brand outline-none">
                </div>
                <div class="flex gap-3">
                    <div class="flex-1">
                        <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Duração (min)</label>
                        <input type="number" id="edit-appt-duration" min="5" step="5" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-brand outline-none">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Cor</label>
                        <input type="color" id="edit-appt-color" class="h-9 w-12 border-none rounded cursor-pointer bg-transparent">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Nota/Observação</label>
                    <input id="edit-appt-note" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-brand outline-none">
                </div>
                <div class="flex gap-2 pt-2">
                    <button onclick="deleteAppointment()" class="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded shadow-md transition text-xs">DESMARCAR</button>
                    <button onclick="saveApptEdit()" class="flex-1 bg-brand hover:opacity-90 text-white font-bold py-2 rounded shadow-md transition text-xs">SALVAR</button>
                </div>
            </div>
        </div>
    </div>

    <div id="modal-manage-doctors" class="fixed inset-0 z-[100] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-[500px] overflow-hidden animate-fade-in-up">
            <div class="bg-slate-700 p-4 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm uppercase tracking-wide"><i class="fas fa-user-md mr-2"></i> Gerenciar Médicos</h3>
                <button onclick="closeDoctorsModal()" class="hover:text-gray-200 text-xl">&times;</button>
            </div>
            <div class="p-6">
                <div class="flex gap-2 mb-6">
                    <input id="new-doctor-name" class="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-slate-500 outline-none" placeholder="Nome do novo Doutor(a)">
                    <button onclick="addDoctor()" class="bg-brand hover:opacity-90 text-white px-4 rounded font-bold text-sm">ADICIONAR</button>
                </div>
                <h4 class="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase mb-3">Lista Atual</h4>
                <div id="doctors-list-settings" class="space-y-2 max-h-60 overflow-y-auto pr-2"></div>
            </div>
        </div>
    </div>
    
    <div id="modal-instagram" class="fixed inset-0 z-[90] bg-black/60 hidden flex items-center justify-center backdrop-blur-sm transition-opacity">
        <div class="bg-white dark:bg-slate-800 w-[400px] rounded border border-gray-300 dark:border-slate-700 flex flex-col items-center p-8 relative animate-fade-in-up shadow-2xl">
            <button onclick="closeInstaModal()" class="absolute top-2 right-3 text-gray-400 hover:text-gray-800 dark:hover:text-white text-2xl">&times;</button>
            <h2 class="text-2xl font-bold mb-2 text-gray-800 dark:text-white">Conectar API Oficial</h2>
            <p class="text-xs text-gray-500 dark:text-slate-400 mb-6 text-center">Insira o Token de Acesso da Meta (Graph API) para ativar as mensagens.</p>
            <div id="insta-form" class="w-full flex flex-col gap-3">
                <textarea id="insta-token" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-xs h-24 focus:ring-2 focus:ring-brand outline-none" placeholder="Cole seu Token (EAA...) aqui..."></textarea>
                <button id="btn-insta-login" onclick="connectInstagram()" class="w-full bg-brand hover:opacity-90 text-white font-bold py-2 rounded text-sm transition">CONECTAR</button>
                <p id="insta-error" class="text-xs text-red-500 text-center hidden"></p>
            </div>
            <div id="insta-loading" class="hidden flex flex-col items-center py-4"><div class="loader mb-3"></div><p class="text-xs text-gray-500 dark:text-slate-400 font-medium">Validando Token...</p></div>
        </div>
    </div>

    <div id="modal-import" class="fixed inset-0 z-[90] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
         <div class="bg-white dark:bg-slate-800 w-[900px] h-[600px] rounded-xl flex flex-col overflow-hidden relative">
            <button onclick="document.getElementById('modal-import').classList.add('hidden')" class="absolute top-4 right-4 z-10 text-gray-500 hover:text-black dark:hover:text-white text-2xl">&times;</button>
            <div class="p-6 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-900">
                <h2 class="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2"><i class="fab fa-instagram text-pink-600"></i> Importar Conversas</h2>
                <button onclick="runImport()" class="bg-brand text-white px-4 py-2 rounded text-sm font-bold shadow hover:opacity-90 transition"><i class="fas fa-sync-alt animate-spin-slow"></i> Iniciar Varredura</button>
            </div>
            <div class="flex-1 bg-gray-100 dark:bg-slate-900 p-6 overflow-y-auto relative">
                <div id="import-empty" class="flex flex-col items-center justify-center h-full text-gray-400"><i class="fas fa-inbox text-6xl mb-4 opacity-20"></i><p>Clique em "Iniciar Varredura" para buscar novas conversas.</p></div>
                <div id="import-loading" class="absolute inset-0 bg-white/80 dark:bg-slate-800/80 z-20 flex flex-col items-center justify-center hidden"><div class="loader mb-4 w-12 h-12 border-4"></div><h3 class="text-lg font-bold text-gray-700 dark:text-white">Analisando Directs...</h3></div>
                <div id="import-grid" class="grid grid-cols-3 gap-4"></div>
            </div>
         </div>
    </div>

    <div id="modal-profile" class="fixed inset-0 z-[80] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-white dark:bg-slate-800 w-[900px] h-[650px] rounded-lg shadow-2xl flex overflow-hidden animate-fade-in-up relative">
            <div class="w-64 bg-gray-50 dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 p-6 flex flex-col gap-1">
                <h2 class="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-4">Configurações Pessoais</h2>
                <div class="tab-btn active" onclick="switchProfileTab('profile', this)"><i class="far fa-user w-5"></i> Perfil e Visibilidade</div>
                <div class="tab-btn" onclick="switchProfileTab('activity', this)"><i class="fas fa-stream w-5"></i> Atividade</div>
                <div class="tab-btn" onclick="switchProfileTab('cards', this)"><i class="far fa-id-card w-5"></i> Cartões</div>
                <div class="tab-btn" onclick="switchProfileTab('settings', this)"><i class="fas fa-cog w-5"></i> Configurações</div>
            </div>
            <div class="flex-1 relative bg-white dark:bg-slate-800">
                <button onclick="document.getElementById('modal-profile').classList.add('hidden')" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-white text-2xl z-10">&times;</button>
                <div id="tab-profile" class="tab-content active h-full overflow-y-auto">
                    <div class="h-32 bg-gray-200 dark:bg-slate-700 w-full relative mb-12">
                        <div class="absolute -bottom-10 left-8 w-24 h-24 rounded-full bg-brand border-4 border-white dark:border-slate-800 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
                            {{ current_user.username[0]|upper }}
                        </div>
                    </div>
                    <div class="px-8 pb-8">
                        <div class="mb-6">
                            <h2 class="text-xl font-bold text-gray-800 dark:text-white">{{ current_user.username }}</h2>
                            <p class="text-sm text-gray-500 dark:text-slate-400">@{{ current_user.username }}</p>
                        </div>
                    </div>
                </div>
                <div id="tab-activity" class="tab-content h-full overflow-y-auto">
                    <div class="p-8">
                        <h2 class="text-lg font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2"><i class="fas fa-list"></i> Atividade Recente</h2>
                        <div id="profile-activity-list" class="space-y-0"><div class="loader"></div></div>
                    </div>
                </div>
                <div id="tab-cards" class="tab-content h-full flex flex-col items-center justify-center text-gray-400">
                    <i class="far fa-id-card text-5xl mb-4 opacity-50"></i><p>Você não tem cartões.</p>
                </div>
                <div id="tab-settings" class="tab-content h-full flex flex-col items-center justify-center text-gray-400">
                    <i class="fas fa-cogs text-5xl mb-4 opacity-50"></i><p>Configurações.</p>
                </div>
            </div>
        </div>
    </div>

    <div id="modal-edit-lead" class="fixed inset-0 z-[100] bg-black/70 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-96 overflow-hidden animate-fade-in-up transform scale-100 transition-transform">
            <div class="bg-brand p-4 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm uppercase tracking-wide">Editar Lead</h3>
                <button onclick="document.getElementById('modal-edit-lead').classList.add('hidden')" class="hover:text-gray-200 text-xl">&times;</button>
            </div>
            <div class="p-6 space-y-4">
                <input type="hidden" id="edit-lead-id">
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Nome do Lead</label>
                    <input id="edit-lead-name" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-brand outline-none">
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 dark:text-slate-400 mb-1">Valor da Negociação (R$)</label>
                    <input id="edit-lead-value" type="number" step="0.01" class="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 text-sm focus:ring-2 focus:ring-brand outline-none">
                </div>
                <button onclick="saveLeadEdit()" class="w-full bg-brand hover:opacity-90 text-white font-bold py-2 rounded shadow-md transition mt-2">SALVAR ALTERAÇÕES</button>
            </div>
        </div>
    </div>

    {% endif %}

    <script>
        let keys = {}; 
        let timer;
        let DOCTORS = []; 
        let currentDate = new Date();
        let colWidths = JSON.parse(localStorage.getItem('agenda_col_widths')) || {};
        
        // VARIÁVEIS DO GRÁFICO E RELATÓRIO
        let dashboardChart = null;
        let currentReportType = 'contacts';

        document.addEventListener('keydown', e => {
            keys[e.key.toLowerCase()] = true;
            if (keys['a'] && keys['d'] && keys['m'] && !timer) {
                timer = setTimeout(() => {
                    document.getElementById('modal-admin-login').classList.remove('hidden');
                    document.getElementById('admin-pwd').focus();
                    keys = {};
                }, 3000);
            }
        });
        
        document.addEventListener('keyup', e => { 
            delete keys[e.key.toLowerCase()]; 
            if(timer) {
                clearTimeout(timer); 
                timer = null;
            } 
        });

        function authAdmin() {
            if(document.getElementById('admin-pwd').value === "2026") {
                document.getElementById('modal-admin-login').classList.add('hidden');
                document.getElementById('modal-admin-panel').classList.remove('hidden');
                loadAdminUsers();
            } else { 
                alert("Senha incorreta!"); 
            }
        }

        function toggleTheme() {
            if (document.documentElement.classList.contains('dark')) {
                document.documentElement.classList.remove('dark');
                localStorage.theme = 'light';
            } else {
                document.documentElement.classList.add('dark');
                localStorage.theme = 'dark';
            }
            if(dashboardChart) {
                loadDashboardData();
            }
        }
        
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) { 
            document.documentElement.classList.add('dark'); 
        } else { 
            document.documentElement.classList.remove('dark'); 
        }

        function openInstaModal() { 
            document.getElementById('modal-instagram').classList.remove('hidden'); 
        }
        
        function closeInstaModal() { 
            document.getElementById('modal-instagram').classList.add('hidden'); 
        }

        function connectInstagram() {
            const token = document.getElementById('insta-token').value; 
            const form = document.getElementById('insta-form'); 
            const loading = document.getElementById('insta-loading'); 
            const errorMsg = document.getElementById('insta-error');
            
            if(!token) { 
                errorMsg.innerText = "Cole o token."; 
                errorMsg.classList.remove('hidden'); 
                return; 
            }
            
            form.classList.add('hidden'); 
            loading.classList.remove('hidden'); 
            errorMsg.classList.add('hidden');
            
            fetch('/api/instagram/connect', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({token: token}) 
            })
            .then(async r => { 
                if (!r.ok) { 
                    const text = await r.text(); 
                    throw new Error(`Erro do Servidor (${r.status}): Verifique o terminal Python.`); 
                } 
                return r.json(); 
            })
            .then(data => { 
                if(data.success) { 
                    closeInstaModal(); 
                    document.getElementById('modal-import').classList.remove('hidden'); 
                    alert("Instagram Conectado! ID: " + data.page_id); 
                } else { 
                    throw new Error(data.error || "Erro desconhecido na API."); 
                } 
            })
            .catch(err => { 
                form.classList.remove('hidden'); 
                loading.classList.add('hidden'); 
                errorMsg.innerText = err.message; 
                errorMsg.classList.remove('hidden'); 
                console.error("Debug Erro:", err); 
            });
        }

        function setTab(t) { 
            document.getElementById('tab-users').classList.add('hidden'); 
            document.getElementById('tab-pipelines').classList.add('hidden'); 
            document.getElementById(`tab-${t}`).classList.remove('hidden'); 
            if(t === 'pipelines') {
                loadAdminPipes(); 
            } else {
                loadAdminUsers(); 
            }
        }

        function loadAdminUsers() {
            fetch('/api/admin/users')
            .then(r => r.json())
            .then(d => {
                const l = document.getElementById('list-users'); 
                l.innerHTML = '';
                d.users.forEach(u => {
                    l.innerHTML += `
                    <div class="bg-white dark:bg-slate-700 p-4 rounded-xl border border-gray-200 dark:border-slate-600 flex items-center justify-between shadow-sm hover:shadow-md transition">
                        <div>
                            <div class="font-bold text-gray-800 dark:text-white text-lg">${u.username}</div>
                            <div class="text-xs text-gray-400 font-mono">ID: ${u.id}</div>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="flex flex-col">
                                <label class="text-[10px] font-bold text-gray-400 uppercase">Session ID</label>
                                <div class="flex gap-1">
                                    <input id="s-${u.id}" value="${u.session_id||''}" class="border rounded text-xs p-1.5 w-40 bg-gray-50 dark:bg-slate-800 dark:border-slate-600 dark:text-white focus:bg-white dark:focus:bg-slate-600 transition" placeholder="Cole aqui...">
                                    <button onclick="saveSess(${u.id})" class="text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 px-2 rounded"><i class="fas fa-save"></i></button>
                                </div>
                            </div>
                            <div class="flex flex-col">
                                <label class="text-[10px] font-bold text-gray-400 uppercase">Pipeline #</label>
                                <div class="flex gap-1">
                                    <input id="p-${u.id}" value="${u.pipeline_id}" type="number" class="border rounded text-xs p-1.5 w-16 text-center bg-gray-50 dark:bg-slate-800 dark:border-slate-600 dark:text-white focus:bg-white dark:focus:bg-slate-600 transition">
                                    <button onclick="savePipe(${u.id})" class="text-brand hover:bg-brand/10 dark:hover:bg-brand/30 px-2 rounded"><i class="fas fa-check"></i></button>
                                </div>
                            </div>
                            <button onclick="delUser(${u.id})" class="text-red-400 hover:text-red-600 ml-2 p-2 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full transition"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>`;
                });
            });
        }
        
        function admCreateUser() { 
            fetch('/api/admin/users', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    username: document.getElementById('new-u').value,
                    password: document.getElementById('new-p').value
                })
            }).then(() => loadAdminUsers()); 
        }
        
        function saveSess(id) { 
            fetch('/api/admin/users/update', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    id: id,
                    session_id: document.getElementById(`s-${id}`).value
                })
            }).then(() => alert('Session Salvo!')); 
        }
        
        function savePipe(id) { 
            fetch('/api/admin/users/update', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    id: id,
                    pipeline_id: document.getElementById(`p-${id}`).value
                })
            }).then(() => alert('Pipeline Vinculado!')); 
        }
        
        function delUser(id) { 
            if(confirm('Tem certeza?')) {
                fetch('/api/admin/users/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: id})
                }).then(() => loadAdminUsers());
            }
        }
        
        function loadAdminPipes() {
            fetch('/api/admin/pipelines')
            .then(r => r.json())
            .then(d => {
                const l = document.getElementById('list-pipelines'); 
                l.innerHTML = '';
                d.pipelines.forEach(p => {
                    let stHtml = '';
                    p.stages.forEach(s => { 
                        stHtml += `
                        <div class="flex justify-between items-center text-xs bg-gray-50 dark:bg-slate-900 p-2 rounded mb-1 border border-gray-100 dark:border-slate-600 group">
                            <span class="flex items-center gap-2">
                                <span class="w-3 h-3 rounded-full shadow-sm" style="background:${s.color}"></span>
                                <span class="font-medium text-gray-700 dark:text-slate-300">${s.name}</span>
                            </span>
                            <button onclick="delStage(${s.id})" class="text-red-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition">&times;</button>
                        </div>`; 
                    });
                    
                    l.innerHTML += `
                    <div class="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-md transition">
                        <div class="flex justify-between items-center border-b dark:border-slate-600 pb-3 mb-3">
                            <h4 class="font-bold text-lg text-gray-800 dark:text-white">#${p.id} - ${p.name}</h4>
                            <button onclick="delPipe(${p.id})" class="text-red-500 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-900/30 px-2 py-1 rounded transition">EXCLUIR CONJUNTO</button>
                        </div>
                        <div class="mb-4 pl-2 border-l-4 border-gray-100 dark:border-slate-700 space-y-1">${stHtml}</div>
                        <div class="flex gap-2 bg-gray-50 dark:bg-slate-900 p-2 rounded-lg border border-gray-200 dark:border-slate-700">
                            <input id="st-n-${p.id}" placeholder="Nome da Nova Coluna" class="border-none bg-transparent text-xs flex-1 outline-none dark:text-white">
                            <input id="st-c-${p.id}" type="color" value="#206aba" class="w-6 h-6 rounded cursor-pointer border-none">
                            <button onclick="addStage(${p.id})" class="bg-brand text-white px-3 py-1 rounded text-xs font-bold hover:opacity-90 transition">ADD</button>
                        </div>
                    </div>`;
                });
            });
        }
        
        function admCreatePipe() { 
            fetch('/api/admin/pipelines', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: document.getElementById('new-pipe').value})
            }).then(() => loadAdminPipes()); 
        }
        
        function delPipe(id) { 
            if(confirm('ATENÇÃO: Apagará todos os leads e colunas deste funil!')) {
                fetch('/api/admin/pipelines/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: id})
                }).then(() => loadAdminPipes());
            }
        }
        
        function addStage(pid) { 
            fetch('/api/admin/stages', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    pipeline_id: pid,
                    name: document.getElementById(`st-n-${pid}`).value,
                    color: document.getElementById(`st-c-${pid}`).value
                })
            }).then(() => loadAdminPipes()); 
        }
        
        function delStage(sid) { 
            if(confirm('Remover coluna?')) {
                fetch('/api/admin/stages/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: sid})
                }).then(() => loadAdminPipes()); 
            }
        }

        {% if current_user.is_authenticated %}
        const MY_STAGES = {{ stages | tojson }};
        let GLOBAL_THREADS = [];

        function viewApp(v) {
            const views = ['hub', 'kanban', 'chat', 'quality', 'agenda', 'finance'];
            
            views.forEach(view => {
                const el = document.getElementById(`view-${view}`);
                if (el) { 
                    el.classList.add('hidden'); 
                    if (view !== 'hub' && view !== 'quality' && view !== 'finance') {
                        el.classList.add('opacity-0'); 
                    }
                }
                const btn = document.getElementById(`nav-${view}`);
                if (btn) { 
                    btn.classList.remove('active-leads', 'active-chat', 'active-agenda'); 
                    btn.classList.add('inactive'); 
                }
            });

            const selected = document.getElementById(`view-${v}`);
            if (selected) { 
                selected.classList.remove('hidden'); 
                if (v !== 'hub') {
                    setTimeout(() => selected.classList.remove('opacity-0'), 10); 
                }
            }

            if (v === 'chat') loadThreads();
            if (v === 'agenda') loadDoctorsAndRender();
            if (v === 'quality') loadDashboardData(); 
            if (v === 'finance') loadFinanceData();
        }
        
        // --- LÓGICA DO FINANCEIRO E ORÇAMENTOS ---
        function openBudgetModal() {
            document.getElementById('budget-patient').value = '';
            document.getElementById('budget-cpf').value = '';
            document.getElementById('budget-phone').value = '';
            document.getElementById('budget-procedure').value = '';
            document.getElementById('budget-amount').value = '';
            document.getElementById('modal-new-budget').classList.remove('hidden');
        }

        function closeBudgetModal() {
            document.getElementById('modal-new-budget').classList.add('hidden');
        }

        function saveBudget() {
            const payload = {
                patient_name: document.getElementById('budget-patient').value,
                cpf: document.getElementById('budget-cpf').value,
                phone: document.getElementById('budget-phone').value,
                procedure: document.getElementById('budget-procedure').value,
                amount: parseFloat(document.getElementById('budget-amount').value) || 0
            };
            
            if(!payload.patient_name) {
                return alert("Preencha o nome do paciente");
            }
            
            fetch('/api/finance/budget', {
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(payload)
            })
            .then(r => r.json())
            .then(data => {
                if(data.success) {
                    closeBudgetModal();
                    loadFinanceData();
                }
            });
        }

        function loadFinanceData() {
            fetch('/api/finance/data')
            .then(r => r.json())
            .then(data => {
                // Atualiza Cards
                document.getElementById('fin-faturamento').innerText = 'R$ ' + data.faturamento.toLocaleString('pt-BR', {minimumFractionDigits: 2});
                document.getElementById('fin-pendente').innerText = 'R$ ' + data.pendente.toLocaleString('pt-BR', {minimumFractionDigits: 2});
                document.getElementById('fin-total-qtd').innerText = data.budgets.length;
                
                let total_app = data.budgets.filter(b => b.status === 'APROVADO').length;
                let rate = data.budgets.length > 0 ? Math.round((total_app / data.budgets.length) * 100) : 0;
                document.getElementById('fin-aprovacao-rate').innerText = rate + "% de Aprovação";

                // Atualiza Lista
                const list = document.getElementById('fin-budgets-list');
                list.innerHTML = '';
                
                if(data.budgets.length === 0) {
                    list.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-gray-500 italic">Nenhum orçamento cadastrado.</td></tr>';
                    return;
                }

                data.budgets.forEach(b => {
                    let d_str = new Date(b.created_at).toLocaleDateString('pt-BR');
                    let val_str = 'R$ ' + b.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2});
                    
                    let statusClass = "status-pendente";
                    if(b.status === 'APROVADO') statusClass = "status-aprovado";
                    if(b.status === 'RECUSADO') statusClass = "status-recusado";

                    // CORREÇÃO: O botão de excluir aparece sempre. Botão de aprovar/recusar some se já foi respondido.
                    let actionButtons = '';
                    
                    if (b.status === 'PENDENTE') {
                        actionButtons += `
                            <button onclick="updateBudgetStatus(${b.id}, 'APROVADO')" class="text-green-500 hover:text-green-700 bg-green-50 dark:bg-green-900/30 p-1.5 rounded mr-1" title="Aprovar"><i class="fas fa-check"></i></button>
                            <button onclick="updateBudgetStatus(${b.id}, 'RECUSADO')" class="text-orange-500 hover:text-orange-700 bg-orange-50 dark:bg-orange-900/30 p-1.5 rounded mr-2" title="Recusar"><i class="fas fa-times"></i></button>
                        `;
                    }
                    
                    // Botão de deletar fixo para todos os status
                    actionButtons += `<button onclick="deleteBudget(${b.id})" class="text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/30 p-1.5 rounded" title="Excluir"><i class="fas fa-trash-alt"></i></button>`;

                    list.innerHTML += `
                        <tr class="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition">
                            <td class="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-slate-400">${d_str}</td>
                            <td class="px-6 py-4 whitespace-nowrap font-bold text-gray-800 dark:text-white">${b.patient_name}</td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <p class="text-gray-800 dark:text-slate-200">${b.phone || '-'}</p>
                                <p class="text-[10px] text-gray-400">CPF: ${b.cpf || '-'}</p>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-slate-300">${b.procedure || '-'}</td>
                            <td class="px-6 py-4 whitespace-nowrap font-bold text-right text-gray-800 dark:text-white">${val_str}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-center"><span class="status-badge ${statusClass}">${b.status}</span></td>
                            <td class="px-6 py-4 whitespace-nowrap text-center">${actionButtons}</td>
                        </tr>
                    `;
                });
            });
        }

        function updateBudgetStatus(id, newStatus) {
            fetch('/api/finance/budget/update', {
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({id: id, status: newStatus})
            }).then(() => {
                loadFinanceData();
            });
        }
        
        function deleteBudget(id) {
            if(confirm("Tem certeza que deseja excluir este orçamento definitivamente?")) {
                fetch('/api/finance/budget/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: id})
                }).then(() => {
                    loadFinanceData();
                });
            }
        }

        // --- LÓGICA DOS RELATÓRIOS E CHART.JS ---
        function changeReportTab(type, btn) {
            currentReportType = type;
            
            document.querySelectorAll('.rep-tab-btn').forEach(el => { 
                el.classList.remove('bg-brand', 'text-white', 'shadow', 'active'); 
                el.classList.add('text-gray-500', 'dark:text-slate-400'); 
            });
            
            btn.classList.add('bg-brand', 'text-white', 'shadow', 'active'); 
            btn.classList.remove('text-gray-500', 'dark:text-slate-400');
            
            const topBanner = document.getElementById('rep-top-banner'); 
            const icon = document.getElementById('rep-highlight-icon');
            
            if(type === 'contacts') { 
                topBanner.className = 'bg-brand rounded-2xl p-8 text-white shadow-lg mb-6 flex justify-between items-center relative overflow-hidden transition-colors duration-500'; 
                icon.className = 'fas fa-chart-line absolute -right-4 -bottom-4 text-8xl text-white opacity-10'; 
            } 
            else if (type === 'budget') { 
                topBanner.className = 'bg-purple-600 rounded-2xl p-8 text-white shadow-lg mb-6 flex justify-between items-center relative overflow-hidden transition-colors duration-500'; 
                icon.className = 'fas fa-wallet absolute -right-4 -bottom-4 text-8xl text-white opacity-10'; 
            } 
            else { 
                topBanner.className = 'bg-cyan-600 rounded-2xl p-8 text-white shadow-lg mb-6 flex justify-between items-center relative overflow-hidden transition-colors duration-500'; 
                icon.className = 'far fa-calendar-alt absolute -right-4 -bottom-4 text-8xl text-white opacity-10'; 
            }

            loadDashboardData();
        }

        function loadDashboardData() {
            document.getElementById('rep-highlight-value').innerHTML = '<div class="loader" style="border-color:#fff; border-top-color: transparent; width:30px; height:30px;"></div>';
            
            fetch('/api/reports/dashboard')
            .then(r => r.json())
            .then(data => { 
                renderChart(data); 
                updateDashboardCards(data); 
            });
        }

        function updateDashboardCards(data) {
            let info = data[currentReportType];
            
            let title = currentReportType === 'contacts' ? 'Total de Leads Cadastrados (7 dias)' : 
                        currentReportType === 'budget' ? 'Orçamentos Fechados em Kanban (7 dias)' : 
                        'Total de Agendamentos (7 dias)';
                        
            let val = currentReportType === 'budget' ? 'R$ ' + info.total.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : info.total;
            
            document.getElementById('rep-highlight-title').innerText = title; 
            document.getElementById('rep-highlight-value').innerText = val;

            if(currentReportType === 'contacts') {
                document.getElementById('rep-side-1-title').innerText = 'Taxa de Conversão'; 
                document.getElementById('rep-side-1-val').innerText = info.conversion; 
                document.getElementById('rep-side-1-desc').innerText = "Leads movidos para Fechado";
                
                document.getElementById('rep-side-2-title').innerText = 'Em Negociação'; 
                document.getElementById('rep-side-2-val').innerText = info.em_negociacao; 
                document.getElementById('rep-side-2-desc').innerText = "Oportunidades ativas";
                
            } else if(currentReportType === 'budget') {
                document.getElementById('rep-side-1-title').innerText = 'Ticket Médio'; 
                document.getElementById('rep-side-1-val').innerText = 'R$ ' + info.ticket_medio.toLocaleString('pt-BR', {minimumFractionDigits: 2}); 
                document.getElementById('rep-side-1-desc').innerText = "Por Lead Fechado";
                
                document.getElementById('rep-side-2-title').innerText = 'Receita Potencial'; 
                document.getElementById('rep-side-2-val').innerText = 'R$ ' + info.pendente.toLocaleString('pt-BR', {minimumFractionDigits: 2}); 
                document.getElementById('rep-side-2-desc').innerText = "Valor nos Leads Pendentes";
                
            } else {
                document.getElementById('rep-side-1-title').innerText = 'Agendados'; 
                document.getElementById('rep-side-1-val').innerText = info.retornos; 
                document.getElementById('rep-side-1-desc').innerText = "Consultas totais 7 dias";
                
                document.getElementById('rep-side-2-title').innerText = 'Cancelados/Faltas'; 
                document.getElementById('rep-side-2-val').innerText = info.cancelados; 
                document.getElementById('rep-side-2-desc').innerText = "Taxa de abstenção (Em breve)";
            }

            document.getElementById('rep-bot-1').innerText = data.general.total_leads; 
            document.getElementById('rep-bot-2').innerText = 'R$ ' + data.general.total_revenue.toLocaleString('pt-BR', {minimumFractionDigits: 2}); 
            document.getElementById('rep-bot-3').innerText = data.general.today_appts;
        }

        function renderChart(data) {
            const ctx = document.getElementById('mainChart').getContext('2d');
            let info = data[currentReportType];
            
            if(dashboardChart) {
                dashboardChart.destroy();
            }
            
            let isDark = document.documentElement.classList.contains('dark');
            let gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
            let textColor = isDark ? '#94a3b8' : '#64748b';
            
            let barColor = '#206aba'; 
            let labelName = 'Contatos Cadastrados';
            
            if(currentReportType === 'budget') { 
                barColor = '#9333ea'; 
                labelName = 'Receita Fechada (R$)'; 
            }
            if(currentReportType === 'appointments') { 
                barColor = '#0891b2'; 
                labelName = 'Agendamentos Efetuados'; 
            }

            dashboardChart = new Chart(ctx, {
                type: 'bar',
                data: { 
                    labels: data.labels, 
                    datasets: [{ 
                        label: labelName, 
                        data: info.data, 
                        backgroundColor: barColor, 
                        borderRadius: 6, 
                        barThickness: 20 
                    }] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    animation: { duration: 1000, easing: 'easeOutQuart' }, 
                    plugins: { legend: { display: false } }, 
                    scales: { 
                        y: { 
                            beginAtZero: true, 
                            grid: { color: gridColor, drawBorder: false }, 
                            ticks: { color: textColor } 
                        }, 
                        x: { 
                            grid: { display: false, drawBorder: false }, 
                            ticks: { color: textColor } 
                        } 
                    } 
                }
            });
            
            document.getElementById('rep-chart-title').innerText = currentReportType === 'contacts' ? 'Evolução de Novos Leads' : currentReportType === 'budget' ? 'Volume de Vendas (Kanban)' : 'Evolução da Agenda';
        }

        // --- DOCTORS MANAGEMENT LOGIC ---
        function loadDoctorsAndRender() { 
            fetch('/api/settings/doctors')
            .then(r => r.json())
            .then(data => { 
                DOCTORS = data.doctors; 
                renderAgenda(); 
                renderMiniCalendar(); 
            }); 
        }
        
        function openDoctorsModal() { 
            document.getElementById('modal-manage-doctors').classList.remove('hidden'); 
            loadDoctorsSettings(); 
        }
        
        function closeDoctorsModal() { 
            document.getElementById('modal-manage-doctors').classList.add('hidden'); 
            loadDoctorsAndRender(); 
        }
        
        function loadDoctorsSettings() { 
            fetch('/api/settings/doctors')
            .then(r => r.json())
            .then(data => { 
                const list = document.getElementById('doctors-list-settings'); 
                list.innerHTML = ''; 
                data.doctors.forEach(doc => { 
                    let eyeIcon = doc.visible ? 'fa-eye text-brand' : 'fa-eye-slash text-gray-400'; 
                    let titleText = doc.visible ? 'Ocultar da Agenda' : 'Mostrar na Agenda'; 
                    list.innerHTML += `
                    <div class="flex items-center gap-2 bg-gray-50 dark:bg-slate-700 p-2 rounded border dark:border-slate-600">
                        <button onclick="toggleDoctorVisibility(${doc.id}, ${doc.visible})" class="hover:bg-gray-200 dark:hover:bg-slate-600 p-1.5 rounded transition" title="${titleText}"><i class="fas ${eyeIcon}"></i></button>
                        <input id="doc-name-${doc.id}" value="${doc.name}" class="bg-transparent border-none outline-none text-sm dark:text-white flex-1 font-medium ${doc.visible ? '' : 'text-gray-400 line-through decoration-gray-400'}">
                        <button onclick="updateDoctor(${doc.id})" class="text-brand hover:opacity-80 text-xs font-bold px-2">SALVAR</button>
                        <button onclick="deleteDoctor(${doc.id})" class="text-red-400 hover:text-red-600 text-xs font-bold px-2">&times;</button>
                    </div>`; 
                }); 
            }); 
        }
        
        function toggleDoctorVisibility(id, currentStatus) { 
            let newStatus = currentStatus ? 0 : 1; 
            fetch('/api/settings/doctors', { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({id: id, visible: newStatus}) 
            }).then(() => loadDoctorsSettings()); 
        }
        
        function addDoctor() { 
            const name = document.getElementById('new-doctor-name').value; 
            if(!name) return; 
            fetch('/api/settings/doctors', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({name: name}) 
            }).then(() => { 
                document.getElementById('new-doctor-name').value = ''; 
                loadDoctorsSettings(); 
            }); 
        }
        
        function updateDoctor(id) { 
            const name = document.getElementById(`doc-name-${id}`).value; 
            fetch('/api/settings/doctors', { 
                method: 'PUT', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({id: id, name: name}) 
            }).then(() => alert('Nome atualizado!')); 
        }
        
        function deleteDoctor(id) { 
            if(confirm("Remover este médico da agenda?")) { 
                fetch('/api/settings/doctors', { 
                    method: 'DELETE', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({id: id}) 
                }).then(() => loadDoctorsSettings()); 
            } 
        }
        
        // --- AGENDA LOGIC ---
        function renderAgenda() {
            const header = document.getElementById('doctors-header'); 
            const body = document.getElementById('agenda-grid-body'); 
            if(!header || !body) return; 
            
            header.innerHTML = ''; 
            body.innerHTML = '';
            
            const visibleDoctors = DOCTORS.filter(d => d.visible);
            
            visibleDoctors.forEach(doc => { 
                const cleanName = doc.name.replace(/\s/g, ''); 
                let style = colWidths[cleanName] ? `width: ${colWidths[cleanName]}px; flex: none;` : `flex: 1; min-width: 150px;`; 
                header.innerHTML += `<div class="doctor-header relative" id="header-${cleanName}" style="${style}">${doc.name}<div class="resizer" onmousedown="startResize(event, '${cleanName}')"></div></div>`; 
            });
            
            visibleDoctors.forEach(doc => { 
                const cleanName = doc.name.replace(/\s/g, ''); 
                let style = colWidths[cleanName] ? `width: ${colWidths[cleanName]}px; flex: none;` : `flex: 1; min-width: 150px;`; 
                let colHtml = `<div id="col-${cleanName}" class="border-r border-gray-200 dark:border-slate-700 relative" style="${style}">`; 
                
                for(let h=8; h<19; h++) { 
                    ['00','15','30','45'].forEach(m => { 
                        let time = `${h.toString().padStart(2,'0')}:${m}`; 
                        let docIdClean = doc.name.replace(/\s/g,''); 
                        colHtml += `<div onclick="openApptModal('${doc.name}', '${time}')" class="calendar-cell" id="slot-${docIdClean}-${time}"></div>`; 
                    }); 
                } 
                colHtml += `</div>`; 
                body.innerHTML += colHtml; 
            });
            
            const dateStr = currentDate.toISOString().split('T')[0];
            fetch(`/api/appointments?date=${dateStr}`)
            .then(r => r.json())
            .then(data => { 
                data.appointments.forEach(appt => { 
                    const docIdClean = appt.doctor.replace(/\s/g,''); 
                    const slotId = `slot-${docIdClean}-${appt.time}`; 
                    const slot = document.getElementById(slotId); 
                    
                    if(slot) { 
                        let heightPx = (appt.duration / 15) * 40 - 2; 
                        slot.innerHTML = `
                        <div onclick="openEditApptModal(event, ${appt.id}, '${appt.patient}', '${appt.note}', '${appt.doctor}', '${appt.time}', '${dateStr}', '${appt.procedure || ''}', ${appt.duration || 30}, '${appt.color}')" 
                             class="absolute left-0 right-0 m-0.5 rounded p-1 text-[9px] font-bold text-white shadow-sm overflow-hidden cursor-pointer hover:opacity-90 transition flex flex-col justify-center z-20" 
                             style="background-color: ${appt.color}; top: 0; height: ${heightPx}px;">
                            <span class="truncate block w-full text-center">${appt.patient}</span>
                            <span class="truncate block w-full text-center font-normal opacity-90">${appt.procedure ? appt.procedure : 'Sem procedimento'}</span>
                        </div>`; 
                        slot.title = `${appt.patient} - ${appt.procedure || 'Sem Procedimento'}`; 
                    } 
                }); 
            });
        }
        
        function openEditApptModal(event, id, patient, note, doctor, time, date, procedure, duration, color) { 
            event.stopPropagation(); 
            document.getElementById('edit-appt-id').value = id; 
            document.getElementById('edit-appt-patient').value = patient; 
            document.getElementById('edit-appt-note').value = note == 'None' ? '' : note; 
            document.getElementById('edit-appt-procedure').value = procedure == 'None' ? '' : procedure; 
            document.getElementById('edit-appt-duration').value = duration; 
            document.getElementById('edit-appt-color').value = color; 
            document.getElementById('edit-appt-info').innerText = `${doctor} - ${time} - ${new Date(date + 'T00:00:00').toLocaleDateString()}`; 
            document.getElementById('modal-edit-appointment').classList.remove('hidden'); 
        }
        
        function saveApptEdit() { 
            const payload = { 
                id: document.getElementById('edit-appt-id').value, 
                patient: document.getElementById('edit-appt-patient').value, 
                note: document.getElementById('edit-appt-note').value, 
                procedure: document.getElementById('edit-appt-procedure').value, 
                duration: document.getElementById('edit-appt-duration').value, 
                color: document.getElementById('edit-appt-color').value 
            }; 
            fetch('/api/appointments/update', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(payload) 
            })
            .then(r => r.json())
            .then(data => { 
                if(data.success) { 
                    document.getElementById('modal-edit-appointment').classList.add('hidden'); 
                    renderAgenda(); 
                } 
            }); 
        }
        
        function deleteAppointment() { 
            const id = document.getElementById('edit-appt-id').value; 
            if(confirm("Deseja realmente desmarcar esta consulta?")) { 
                fetch('/api/appointments/delete', { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({id: id}) 
                })
                .then(r => r.json())
                .then(data => { 
                    if(data.success) { 
                        document.getElementById('modal-edit-appointment').classList.add('hidden'); 
                        renderAgenda(); 
                    } else { 
                        alert("Erro ao desmarcar consulta."); 
                    } 
                }); 
            } 
        }

        // Lógica de Redimensionamento
        let startX, startWidth, currentResizerId;
        function startResize(e, id) { 
            e.preventDefault(); 
            currentResizerId = id; 
            const headerEl = document.getElementById(`header-${id}`); 
            startX = e.clientX; 
            startWidth = headerEl.offsetWidth; 
            document.documentElement.addEventListener('mousemove', doResize); 
            document.documentElement.addEventListener('mouseup', stopResize); 
            headerEl.querySelector('.resizer').classList.add('resizing'); 
        }
        
        function doResize(e) { 
            const newWidth = startWidth + (e.clientX - startX); 
            if (newWidth > 100) { 
                const headerEl = document.getElementById(`header-${currentResizerId}`); 
                const colEl = document.getElementById(`col-${currentResizerId}`); 
                const newStyle = `width: ${newWidth}px; flex: none;`; 
                headerEl.style.cssText = newStyle; 
                colEl.style.cssText = newStyle; 
            } 
        }
        
        function stopResize(e) { 
            document.documentElement.removeEventListener('mousemove', doResize); 
            document.documentElement.removeEventListener('mouseup', stopResize); 
            const headerEl = document.getElementById(`header-${currentResizerId}`); 
            headerEl.querySelector('.resizer').classList.remove('resizing'); 
            colWidths[currentResizerId] = headerEl.offsetWidth; 
            localStorage.setItem('agenda_col_widths', JSON.stringify(colWidths)); 
        }

        function renderMiniCalendar() { 
            const grid = document.getElementById('mini-calendar-grid'); 
            const title = document.getElementById('current-month-year'); 
            if(!grid) return; 
            grid.innerHTML = ''; 
            
            const monthNames = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"]; 
            title.innerText = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`; 
            
            const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); 
            const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0); 
            
            for(let i=0; i<firstDay.getDay(); i++) { 
                grid.innerHTML += `<div></div>`; 
            } 
            
            for(let d=1; d<=lastDay.getDate(); d++) { 
                let isSelected = (d === currentDate.getDate()); 
                let classes = "mini-cal-day " + (isSelected ? "active" : "text-gray-600 dark:text-slate-300"); 
                grid.innerHTML += `<div onclick="setDate(${d})" class="${classes}">${d}</div>`; 
            } 
        }
        
        function changeMonth(offset) { 
            currentDate.setMonth(currentDate.getMonth() + offset); 
            renderMiniCalendar(); 
            renderAgenda(); 
        }
        
        function setDate(day) { 
            currentDate.setDate(day); 
            renderMiniCalendar(); 
            renderAgenda(); 
        }

        function openApptModal(doc, time) { 
            document.getElementById('appt-doctor').value = doc; 
            document.getElementById('appt-time').value = time; 
            document.getElementById('appt-date').value = currentDate.toISOString().split('T')[0]; 
            document.getElementById('appt-info').innerText = `${doc} - ${time} - ${currentDate.toLocaleDateString()}`; 
            document.getElementById('appt-patient').value = ''; 
            document.getElementById('appt-procedure').value = ''; 
            document.getElementById('appt-duration').value = '30'; 
            document.getElementById('appt-color').value = '#206aba'; 
            document.getElementById('appt-note').value = ''; 
            document.getElementById('modal-appointment').classList.remove('hidden'); 
        }
        
        function closeApptModal() { 
            document.getElementById('modal-appointment').classList.add('hidden'); 
        }
        
        function saveAppointment() { 
            const data = { 
                doctor: document.getElementById('appt-doctor').value, 
                time: document.getElementById('appt-time').value, 
                date: document.getElementById('appt-date').value, 
                patient: document.getElementById('appt-patient').value, 
                note: document.getElementById('appt-note').value, 
                procedure: document.getElementById('appt-procedure').value, 
                duration: document.getElementById('appt-duration').value, 
                color: document.getElementById('appt-color').value 
            }; 
            
            if(!data.patient) return alert("Nome do paciente obrigatório"); 
            
            fetch('/api/appointments/create', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(data) 
            })
            .then(r => r.json())
            .then(res => { 
                if(res.success) { 
                    closeApptModal(); 
                    renderAgenda(); 
                } 
            }); 
        }
        
        function addKanbanColumn() { 
            const name = prompt("Nome da nova coluna:"); 
            if(name) { 
                const color = "#" + Math.floor(Math.random()*16777215).toString(16); 
                fetch('/api/admin/stages', { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({ 
                        pipeline_id: {{ current_user.pipeline_id }}, 
                        name: name, 
                        color: color 
                    }) 
                }).then(() => location.reload()); 
            } 
        }
        
        function deleteColumn(id) { 
            if(confirm('Tem certeza que deseja excluir esta coluna e todos os leads nela?')) { 
                fetch('/api/admin/stages/delete', { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({id: id}) 
                }).then(() => location.reload()); 
            } 
        }
        
        function toggleCardMenu(e, id) { 
            e.stopPropagation(); 
            document.querySelectorAll('.card-menu').forEach(el => el.style.display = 'none'); 
            const menu = document.getElementById(`card-menu-${id}`); 
            if(menu) menu.style.display = 'block'; 
        }
        
        function openEditLead(id, name, value) { 
            document.getElementById('edit-lead-id').value = id; 
            document.getElementById('edit-lead-name').value = name; 
            document.getElementById('edit-lead-value').value = value == 'None' ? '' : value; 
            document.getElementById('modal-edit-lead').classList.remove('hidden'); 
        }
        
        function saveLeadEdit() { 
            const id = document.getElementById('edit-lead-id').value; 
            const name = document.getElementById('edit-lead-name').value; 
            const value = document.getElementById('edit-lead-value').value; 
            
            fetch('/api/lead/update_details', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({id: id, name: name, value: value}) 
            })
            .then(r => r.json())
            .then(data => { 
                if(data.success) location.reload(); 
            }); 
        }

        let impInterval;
        function runImport(){ 
            document.getElementById('import-loading').classList.remove('hidden'); 
            document.getElementById('import-grid').innerHTML=''; 
            document.getElementById('import-empty').classList.add('hidden'); 
            
            fetch('/api/start_fetch')
            .then(r => r.json())
            .then(d => { 
                if(d.error) { 
                    alert(d.error); 
                    document.getElementById('import-loading').classList.add('hidden'); 
                    if(d.error.includes("Instagram não conectado") || d.error.includes("Token")) {
                        openInstaModal(); 
                    }
                } else { 
                    impInterval = setInterval(checkImport, 1500); 
                } 
            }); 
        }
        
        function checkImport(){ 
            fetch('/api/get_candidates')
            .then(r => r.json())
            .then(d => { 
                if(!d.loading){ 
                    clearInterval(impInterval); 
                    document.getElementById('import-loading').classList.add('hidden'); 
                    renderImport(d.candidates); 
                } 
            }); 
        }
        
        function renderImport(list){ 
            const g = document.getElementById('import-grid'); 
            g.innerHTML = ''; 
            
            if(!list || list.length === 0){
                document.getElementById('import-empty').classList.remove('hidden');
                return;
            } 
            
            list.forEach((u,idx) => { 
                let btns=''; 
                MY_STAGES.forEach(s => { 
                    btns += `<button onclick="addToCrm('${u.username}','${s.name}')" class="w-full text-xs py-2 bg-gray-50 hover:bg-gray-100 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200 border border-gray-200 dark:border-slate-600 rounded text-gray-700 truncate font-medium transition" style="border-left:4px solid ${s.color}">${s.name}</button>`; 
                }); 
                
                g.innerHTML += `
                <div class="h-72 perspective">
                    <div class="flip-inner shadow-lg rounded-xl bg-white dark:bg-slate-800 h-full" id="card-${idx}">
                        <div class="flip-front p-6 border border-gray-200 dark:border-slate-600 flex flex-col items-center justify-between bg-white dark:bg-slate-800 h-full">
                            <div class="flex flex-col items-center w-full">
                                <div class="w-20 h-20 rounded-full border-4 border-white dark:border-slate-700 shadow-md mb-3 bg-gray-200 dark:bg-slate-600 flex items-center justify-center text-2xl font-bold text-gray-400 dark:text-slate-300">${u.name[0]}</div>
                                <h3 class="font-bold text-gray-800 dark:text-white text-sm truncate w-full text-center">${u.name}</h3>
                                <p class="text-xs text-brand mb-2">@${u.username}</p>
                                <span class="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-bold mb-3">${u.time_ago}</span>
                                <div class="w-full bg-gray-50 dark:bg-slate-900 p-2 rounded text-[10px] text-gray-500 dark:text-slate-400 italic text-center line-clamp-2 h-10 border dark:border-slate-700">"${u.last_msg}"</div>
                            </div>
                            <button onclick="document.getElementById('card-${idx}').classList.add('flipped')" class="w-full bg-brand hover:opacity-90 text-white text-xs font-bold py-2.5 rounded-lg transition shadow-md mt-2">ADICIONAR</button>
                        </div>
                        <div class="flip-back p-4 overflow-y-auto bg-white dark:bg-slate-800 h-full flex flex-col">
                            <div class="flex justify-between items-center mb-3 pb-2 border-b dark:border-slate-600">
                                <span class="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Destino</span>
                                <button onclick="document.getElementById('card-${idx}').classList.remove('flipped')" class="text-red-400 hover:text-red-600 font-bold text-xs">VOLTAR</button>
                            </div>
                            <div class="grid grid-cols-2 gap-2 content-start overflow-y-auto flex-1">${btns}</div>
                        </div>
                    </div>
                </div>`; 
            }); 
        }
        
        function addToCrm(u, s){ 
            fetch('/api/get_candidates')
            .then(r => r.json())
            .then(d => { 
                const c = d.candidates.find(x => x.username === u); 
                if(c){ 
                    c.target_stage = s; 
                    fetch('/api/confirm_lead', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(c)
                    }).then(r => r.json()).then(res => {
                        if(res.success) location.reload();
                    }); 
                } 
            }); 
        }

        function loadThreads(){ 
            const list = document.getElementById('chat-list'); 
            list.innerHTML = '<div class="flex flex-col items-center justify-center h-48 space-y-3"><div class="loader"></div><p class="text-gray-400 text-sm">Sincronizando...</p></div>'; 
            
            fetch('/api/chat/threads')
            .then(r => r.json())
            .then(d => { 
                if(!d.success){ 
                    list.innerHTML = `<div class="p-6 text-center"><p class="text-red-500 font-bold mb-2">Erro de Conexão</p><p class="text-xs text-gray-500">${d.error}</p><button onclick="loadThreads()" class="mt-4 text-brand text-sm underline">Tentar Novamente</button></div>`; 
                    return; 
                } 
                GLOBAL_THREADS = d.threads; 
                applyFilter(); 
            })
            .catch(err => { 
                list.innerHTML = `<div class="p-6 text-center text-red-500 text-sm">Erro de rede. Verifique o servidor.</div>`; 
            }); 
        }
        
        function applyFilter() { 
            const filter = document.getElementById('chat-filter').value; 
            const list = document.getElementById('chat-list'); 
            list.innerHTML = ''; 
            
            const filtered = GLOBAL_THREADS.filter(t => { 
                if(filter === 'ALL') return true; 
                if(filter === 'NONE') return !t.lead_info; 
                return t.lead_info && t.lead_info.status === filter; 
            }); 
            
            if(filtered.length === 0) { 
                list.innerHTML = '<div class="p-10 text-center text-gray-400 text-sm italic">Nenhuma conversa.</div>'; 
                return; 
            } 
            
            filtered.forEach(t => { 
                let badge = t.lead_info ? `<span class="text-[9px] px-2 py-0.5 rounded text-white font-bold uppercase shadow-sm" style="background-color:${t.lead_info.color}">${t.lead_info.status}</span>` : ''; 
                
                list.innerHTML += `
                <div onclick="openChat('${t.thread_id}','${t.user.name}','${t.user.username}','${t.user.pic}', '${t.lead_info ? t.lead_info.status : ''}', '${t.lead_info ? t.lead_info.color : ''}')" class="p-4 border-b border-gray-100 dark:border-slate-700 hover:bg-brand/10 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-3 transition group bg-white dark:bg-slate-800">
                    <div class="w-12 h-12 rounded-full bg-gray-200 dark:bg-slate-600 flex items-center justify-center font-bold text-gray-500 dark:text-slate-300 shrink-0">${t.user.name[0]}</div>
                    <div class="overflow-hidden flex-1">
                        <div class="flex items-center justify-between w-full mb-1">
                            <h4 class="font-bold text-sm text-gray-800 dark:text-white truncate group-hover:text-brand dark:group-hover:text-brand transition">${t.user.name}</h4>
                            ${badge}
                        </div>
                        <p class="text-xs text-gray-500 dark:text-slate-400 truncate group-hover:text-gray-700 dark:group-hover:text-slate-200">${t.last_msg}</p>
                    </div>
                </div>`; 
            }); 
        }
        
        function openChat(tid, name, user, pic, status, color){ 
            document.getElementById('chat-header').classList.remove('hidden'); 
            document.getElementById('chat-input').classList.remove('hidden'); 
            document.getElementById('chat-name').innerText = name; 
            document.getElementById('chat-user').innerText = "@" + user; 
            document.getElementById('chat-tid').value = tid; 
            
            const badge = document.getElementById('chat-badge'); 
            if(status) { 
                badge.classList.remove('hidden'); 
                badge.innerText = status; 
                badge.style.backgroundColor = color; 
            } else { 
                badge.classList.add('hidden'); 
            } 
            
            const area = document.getElementById('chat-msgs'); 
            area.innerHTML = '<div class="h-full flex items-center justify-center"><div class="loader"></div></div>'; 
            
            fetch(`/api/chat/messages?thread_id=${tid}`)
            .then(r => r.json())
            .then(d => { 
                area.innerHTML = ''; 
                if(d.success) { 
                    d.messages.reverse().forEach(m => { 
                        area.innerHTML += `<div class="msg-bubble ${m.is_sent_by_me ? 'msg-me' : 'msg-them'}">${m.text}</div>`; 
                    }); 
                    area.scrollTop = area.scrollHeight; 
                } else { 
                    area.innerHTML = '<div class="text-center text-red-400 mt-10">Erro ao carregar mensagens.</div>'; 
                } 
            }); 
        }
        
        function sendMsg(e){ 
            e.preventDefault(); 
            const txt = document.getElementById('msg-txt').value.trim(); 
            const tid = document.getElementById('chat-tid').value; 
            
            if(!txt || !tid) return; 
            
            const area = document.getElementById('chat-msgs'); 
            area.innerHTML += `<div class="msg-bubble msg-me opacity-70">${txt}</div>`; 
            area.scrollTop = area.scrollHeight; 
            document.getElementById('msg-txt').value = ''; 
            
            fetch('/api/chat/send', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({thread_id: tid, text: txt})
            }); 
        }

        function allowDrop(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
        
        function drop(e, st) { 
            e.preventDefault(); 
            e.currentTarget.classList.remove('drag-over');
            fetch('/update_stage', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: e.dataTransfer.getData("text"), status: st})
            }).then(() => location.reload());
        }
        
        function drag(e, id) { e.dataTransfer.setData("text", id); }
        
        function deleteLead(id) { 
            if(confirm("Excluir definitivamente?")) {
                fetch('/delete_lead', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: id})
                }).then(() => location.reload());
            }
        }
        
        function scrollKanban(amount) { 
            const container = document.getElementById('view-kanban'); 
            if(container) { 
                container.scrollBy({ left: amount, behavior: 'smooth' }); 
            } 
        }

        function toggleNotifications() { 
            const portal = document.getElementById('notif-portal'); 
            const menu = document.getElementById('profile-menu'); 
            const mainMenu = document.getElementById('main-menu'); 
            menu.style.display = 'none'; 
            if(mainMenu) mainMenu.style.display = 'none'; 
            portal.style.display = portal.style.display === 'block' ? 'none' : 'block'; 
            if(portal.style.display === 'block') loadNotifications(); 
        }
        
        function loadNotifications() { 
            fetch('/api/notifications')
            .then(r => r.json())
            .then(data => { 
                const badge = document.getElementById('notif-badge'); 
                const list = document.getElementById('notif-list'); 
                
                if(data.total > 0) { 
                    badge.classList.remove('hidden'); 
                    badge.innerText = data.total >= 10 ? '9+' : data.total; 
                } else { 
                    badge.classList.add('hidden'); 
                } 
                
                list.innerHTML = ''; 
                if(data.notifs.length === 0) { 
                    list.innerHTML = '<p class="text-center text-gray-400 text-sm py-10">Nenhuma notificação nova.</p>'; 
                } else { 
                    data.notifs.forEach(n => { 
                        list.innerHTML += `
                        <div class="p-3 border-b hover:bg-brand/10 dark:hover:bg-slate-700 transition flex items-center gap-3 relative">
                            <img src="${n.profile_pic}" class="w-10 h-10 rounded-full border">
                            <div class="flex-1 overflow-hidden">
                                <p class="text-xs font-bold text-gray-800 dark:text-white">${n.name}</p>
                                <p class="text-[11px] text-gray-500 dark:text-slate-400 truncate italic">"${n.last_msg}"</p>
                            </div>
                            <div class="flex flex-col items-center gap-1">
                                <span class="bg-brand/20 text-brand text-[9px] font-bold px-1.5 rounded-full">${n.unread_count}</span>
                                <button onclick="clearNotif(${n.id})" class="text-gray-300 hover:text-brand transition"><i class="fas fa-check-circle"></i></button>
                            </div>
                        </div>`; 
                    }); 
                } 
            }); 
        }
        
        function clearNotif(id) { 
            fetch('/api/notifications/clear', {
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({id: id})
            }).then(() => loadNotifications()); 
        }
        
        function clearAllNotifs() { 
            fetch('/api/notifications/clear', {
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({})
            }).then(() => loadNotifications()); 
        }

        function toggleProfileMenu() { 
            const menu = document.getElementById('profile-menu'); 
            const portal = document.getElementById('notif-portal'); 
            const mainMenu = document.getElementById('main-menu'); 
            portal.style.display = 'none'; 
            if(mainMenu) mainMenu.style.display = 'none'; 
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; 
        }
        
        function toggleMainMenu() { 
            const mainMenu = document.getElementById('main-menu'); 
            const profileMenu = document.getElementById('profile-menu'); 
            const portal = document.getElementById('notif-portal'); 
            portal.style.display = 'none'; 
            profileMenu.style.display = 'none'; 
            mainMenu.style.display = mainMenu.style.display === 'block' ? 'none' : 'block'; 
        }
        
        function toggleActivityPanel() { 
            const panel = document.getElementById('activity-panel'); 
            document.getElementById('profile-menu').style.display = 'none'; 
            panel.classList.toggle('open'); 
            if(panel.classList.contains('open')) loadActivities(); 
        }
        
        function loadActivities() { 
            const list = document.getElementById('activity-list'); 
            const profileList = document.getElementById('profile-activity-list'); 
            
            fetch('/api/activities')
            .then(r => r.json())
            .then(data => { 
                let html = ''; 
                if(data.activities.length === 0) { 
                    html = '<div class="flex flex-col items-center justify-center h-full text-gray-400"><i class="fas fa-history text-4xl mb-2 opacity-50"></i><p class="text-sm">Sem atividades recentes.</p></div>'; 
                } else { 
                    data.activities.forEach(act => { 
                        html += `
                        <div class="activity-item relative flex gap-4 pb-6">
                            <div class="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0 z-10 border-2 border-white dark:border-slate-800">${act.user_initial}</div>
                            <div class="flex-1">
                                <p class="text-sm text-gray-800 dark:text-white"><span class="font-bold">${act.user_name}</span> ${act.description}</p>
                                <span class="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1 mt-1"><i class="far fa-clock"></i> ${act.time_ago}</span>
                            </div>
                        </div>`; 
                    }); 
                } 
                if(list) list.innerHTML = html; 
                if(profileList) profileList.innerHTML = html; 
            }); 
        }

        function openProfileModal() { 
            document.getElementById('profile-menu').style.display = 'none'; 
            document.getElementById('main-menu').style.display = 'none'; 
            document.getElementById('modal-profile').classList.remove('hidden'); 
        }
        
        function switchProfileTab(tabId, btn) { 
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); 
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); 
            document.getElementById(`tab-${tabId}`).classList.add('active'); 
            btn.classList.add('active'); 
            if(tabId === 'activity') loadActivities(); 
        }

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('profile-menu'); 
            const portal = document.getElementById('notif-portal'); 
            const mainMenu = document.getElementById('main-menu'); 
            const actPanel = document.getElementById('activity-panel');
            
            if (!e.target.closest('#profile-menu') && !e.target.closest('[onclick="toggleProfileMenu()"]')) menu.style.display = 'none';
            if (!e.target.closest('#notif-portal') && !e.target.closest('[onclick="toggleNotifications()"]')) portal.style.display = 'none';
            if (!e.target.closest('#main-menu') && !e.target.closest('[onclick="toggleMainMenu()"]')) mainMenu.style.display = 'none';
            if (!e.target.closest('#activity-panel') && !e.target.closest('[onclick="toggleActivityPanel()"]') && actPanel.classList.contains('open')) { actPanel.classList.remove('open'); }
            if (!e.target.closest('.card-menu') && !e.target.closest('[onclick^="toggleCardMenu"]')) { 
                document.querySelectorAll('.card-menu').forEach(el => el.style.display = 'none'); 
            }
        });

        setInterval(loadNotifications, 10000);
        window.onload = loadNotifications;
        {% endif %}
    </script>
</body>
</html>
"""

# --- ROTAS DE GERENCIAMENTO (EXISTENTES) ---
@app.route('/login', methods=['POST'])
def login():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username=?", (request.form['username'],))
    u = cur.fetchone()
    conn.close()
    
    if u and (check_password_hash(u['password'], request.form['password']) or u['password'] == request.form['password']):
        login_user(User(u['id'], u['username'], u['password'], u['meta_token'], u['ig_page_id'], u['pipeline_id']))
        return redirect(url_for('index'))
        
    return render_template_string(HTML_TEMPLATE, error="Login Falhou")

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/')
def index():
    if not current_user.is_authenticated:
        return render_template_string(HTML_TEMPLATE)
        
    c = get_db()
    stages = [dict(r) for r in c.execute("SELECT * FROM stages WHERE pipeline_id=? ORDER BY position ASC", (current_user.pipeline_id,)).fetchall()]
    leads_map = {s['name']: [] for s in stages}
    
    for r in c.execute("SELECT * FROM leads WHERE pipeline_id=?", (current_user.pipeline_id,)).fetchall():
        if r['status'] in leads_map:
            leads_map[r['status']].append(dict(r))
            
    doctors_list = [dict(r) for r in c.execute("SELECT * FROM doctors").fetchall()]
    c.close()
    
    return render_template_string(HTML_TEMPLATE, stages=stages, leads=leads_map, current_user=current_user, doctors=doctors_list)

# --- API FINANCEIRO & ORÇAMENTOS (NOVA) ---
@app.route('/api/finance/data', methods=['GET'])
@login_required
def get_finance_data():
    c = get_db()
    pid = current_user.pipeline_id
    rows = c.execute("SELECT * FROM budgets WHERE pipeline_id=? ORDER BY created_at DESC", (pid,)).fetchall()
    c.close()
    
    budgets = [dict(r) for r in rows]
    faturamento = sum(b['amount'] for b in budgets if b['status'] == 'APROVADO')
    pendente = sum(b['amount'] for b in budgets if b['status'] == 'PENDENTE')
    
    return jsonify({
        "faturamento": faturamento, 
        "pendente": pendente, 
        "budgets": budgets
    })

@app.route('/api/finance/budget', methods=['POST'])
@login_required
def create_budget():
    d = request.json
    c = get_db()
    c.execute(
        "INSERT INTO budgets (patient_name, cpf, phone, procedure, amount, pipeline_id) VALUES (?,?,?,?,?,?)",
        (d.get('patient_name'), d.get('cpf'), d.get('phone'), d.get('procedure'), d.get('amount'), current_user.pipeline_id)
    )
    c.commit()
    c.close()
    
    log_action(current_user.id, f"criou um orçamento de R$ {d.get('amount')} para {d.get('patient_name')}", current_user.pipeline_id)
    return jsonify({"success": True})

@app.route('/api/finance/budget/update', methods=['POST'])
@login_required
def update_budget_status():
    d = request.json
    c = get_db()
    c.execute("UPDATE budgets SET status=? WHERE id=?", (d['status'], d['id']))
    
    budget = c.execute("SELECT patient_name FROM budgets WHERE id=?", (d['id'],)).fetchone()
    if budget:
        status_text = "aprovou" if d['status'] == 'APROVADO' else "recusou"
        log_action(current_user.id, f"{status_text} o orçamento de {budget['patient_name']}", current_user.pipeline_id)
        
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/finance/budget/delete', methods=['POST'])
@login_required
def delete_budget():
    d = request.json
    c = get_db()
    budget = c.execute("SELECT patient_name FROM budgets WHERE id=?", (d['id'],)).fetchone()
    if budget:
        log_action(current_user.id, f"excluiu o orçamento de {budget['patient_name']}", current_user.pipeline_id)
        
    c.execute("DELETE FROM budgets WHERE id=?", (d['id'],))
    c.commit()
    c.close()
    return jsonify({"success": True})


# --- API RELATÓRIOS ANALÍTICOS ---
@app.route('/api/reports/dashboard')
@login_required
def get_dashboard_reports():
    c = get_db()
    pid = current_user.pipeline_id
    
    today = datetime.now()
    labels = [(today - timedelta(days=i)).strftime('%d/%m') for i in range(6, -1, -1)]
    dates_sql = [(today - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(6, -1, -1)]
    
    contacts_data = [0] * 7
    budget_data = [0] * 7
    appts_data = [0] * 7
    
    # Busca Leads/Kanban
    leads = c.execute("SELECT status, value, DATE(created_at) as c_date FROM leads WHERE pipeline_id=?", (pid,)).fetchall()
    total_leads_all = len(leads)
    
    em_negociacao = 0
    fechados_7d = 0
    for lead in leads:
        lead_date = lead['c_date']
        val = lead['value'] if lead['value'] else 0
        
        if lead['status'] in ['NOVOS', 'QUALIFICACAO', 'PROPOSTA', 'NEGOCIACAO']:
            em_negociacao += 1
            
        if lead_date in dates_sql:
            idx = dates_sql.index(lead_date)
            contacts_data[idx] += 1 
            if lead['status'] == 'FECHADO':
                budget_data[idx] += val
                fechados_7d += 1
                
    # Busca Agendamentos
    today_str = today.strftime('%Y-%m-%d')
    appts = c.execute("SELECT date_str FROM appointments WHERE pipeline_id=?", (pid,)).fetchall()
    today_appts = len([a for a in appts if a['date_str'] == today_str])
    
    for appt in appts:
        appt_date = appt['date_str']
        if appt_date in dates_sql:
            idx = dates_sql.index(appt_date)
            appts_data[idx] += 1
            
    # Busca real faturamento do módulo novo de orçamentos para o card inferior
    budgets_all = c.execute("SELECT amount FROM budgets WHERE pipeline_id=? AND status='APROVADO'", (pid,)).fetchall()
    total_revenue_all = sum([b['amount'] for b in budgets_all])
            
    c.close()
    
    total_contacts_7d = sum(contacts_data)
    total_budget_7d = sum(budget_data)
    total_appts_7d = sum(appts_data)
    
    conversion_rate = f"{round((fechados_7d / total_contacts_7d * 100) if total_contacts_7d > 0 else 0)}%"
    ticket_medio = (total_budget_7d / fechados_7d) if fechados_7d > 0 else 0

    return jsonify({
        "labels": labels,
        "contacts": {
            "data": contacts_data, 
            "total": total_contacts_7d, 
            "conversion": conversion_rate, 
            "em_negociacao": em_negociacao
        },
        "budget": {
            "data": budget_data, 
            "total": total_budget_7d, 
            "ticket_medio": ticket_medio, 
            "pendente": sum([l['value'] for l in leads if l['status'] in ['PROPOSTA', 'NEGOCIACAO']])
        },
        "appointments": {
            "data": appts_data, 
            "total": total_appts_7d, 
            "retornos": total_appts_7d, 
            "cancelados": 0
        },
        "general": {
            "total_leads": total_leads_all, 
            "total_revenue": total_revenue_all, 
            "today_appts": today_appts
        }
    })


# --- ADMIN API ---
@app.route('/api/admin/users')
def adm_u():
    c = get_db()
    u = [dict(r) for r in c.execute("SELECT * FROM users").fetchall()]
    c.close()
    return jsonify({"users": u})

@app.route('/api/admin/users', methods=['POST'])
def adm_cu():
    c = get_db()
    c.execute(
        "INSERT INTO users (username,password,pipeline_id) VALUES (?,?,1)",
        (request.json['username'], generate_password_hash(request.json['password']))
    )
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/users/update', methods=['POST'])
def adm_uu():
    d = request.json
    c = get_db()
    if 'session_id' in d:
        c.execute("UPDATE users SET meta_token=? WHERE id=?", (d.get('session_id'), d['id']))
    if 'pipeline_id' in d:
        c.execute("UPDATE users SET pipeline_id=? WHERE id=?", (d.get('pipeline_id'), d['id']))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/users/delete', methods=['POST'])
def adm_du():
    c = get_db()
    c.execute("DELETE FROM users WHERE id=?", (request.json['id'],))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/pipelines')
def adm_p():
    c = get_db()
    ps = [dict(r) for r in c.execute("SELECT * FROM pipelines").fetchall()]
    res = [{**p, "stages": [dict(s) for s in c.execute("SELECT * FROM stages WHERE pipeline_id=?", (p['id'],)).fetchall()]} for p in ps]
    c.close()
    return jsonify({"pipelines": res})

@app.route('/api/admin/pipelines', methods=['POST'])
def adm_cp():
    c = get_db()
    c.execute("INSERT INTO pipelines (name) VALUES (?)", (request.json['name'],))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/pipelines/delete', methods=['POST'])
def adm_dp():
    pid = request.json['id']
    c = get_db()
    c.execute("DELETE FROM leads WHERE pipeline_id=?", (pid,))
    c.execute("DELETE FROM stages WHERE pipeline_id=?", (pid,))
    c.execute("DELETE FROM pipelines WHERE id=?", (pid,))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/stages', methods=['POST'])
def adm_cs():
    d = request.json
    c = get_db()
    c.execute(
        "INSERT INTO stages (name,color,pipeline_id,position) VALUES (?,?,?,99)",
        (d['name'], d['color'], d['pipeline_id'])
    )
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/stages/delete', methods=['POST'])
def adm_ds():
    c = get_db()
    c.execute("DELETE FROM stages WHERE id=?", (request.json['id'],))
    c.commit()
    c.close()
    return jsonify({"success": True})

# --- DOCTORS SETTINGS API ---
@app.route('/api/settings/doctors', methods=['GET'])
@login_required
def get_doctors_api():
    c = get_db()
    docs = [dict(r) for r in c.execute("SELECT * FROM doctors").fetchall()]
    c.close()
    return jsonify({"doctors": docs})

@app.route('/api/settings/doctors', methods=['POST'])
@login_required
def add_doctor_api():
    c = get_db()
    c.execute("INSERT INTO doctors (name) VALUES (?)", (request.json['name'],))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/settings/doctors', methods=['PUT'])
@login_required
def update_doctor_api():
    d = request.json
    c = get_db()
    if 'visible' in d:
        c.execute("UPDATE doctors SET visible = ? WHERE id = ?", (d['visible'], d['id']))
    if 'name' in d:
        c.execute("UPDATE doctors SET name = ? WHERE id = ?", (d['name'], d['id']))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/settings/doctors', methods=['DELETE'])
@login_required
def delete_doctor_api():
    c = get_db()
    c.execute("DELETE FROM doctors WHERE id = ?", (request.json['id'],))
    c.commit()
    c.close()
    return jsonify({"success": True})

# --- RESTANTES (Agenda, Kanban, Chat) ---
@app.route('/api/notifications')
@login_required
def get_notifications():
    c = get_db()
    notifs = c.execute("SELECT id, name, last_msg, profile_pic, unread_count FROM leads WHERE unread_count > 0 AND pipeline_id=?", (current_user.pipeline_id,)).fetchall()
    total = sum([n['unread_count'] for n in notifs])
    c.close()
    return jsonify({"total": total, "notifs": [dict(n) for n in notifs]})

@app.route('/api/notifications/clear', methods=['POST'])
@login_required
def clear_notifications():
    lid = request.json.get('id')
    c = get_db()
    pid = current_user.pipeline_id
    if lid:
        c.execute("UPDATE leads SET unread_count = 0 WHERE id = ?", (lid,))
    else:
        c.execute("UPDATE leads SET unread_count = 0 WHERE pipeline_id = ?", (pid,))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/activities')
@login_required
def get_activities():
    conn = get_db()
    rows = conn.execute('''SELECT a.description, a.created_at, u.username FROM activities a JOIN users u ON a.user_id = u.id WHERE a.pipeline_id = ? ORDER BY a.created_at DESC LIMIT 50''', (current_user.pipeline_id,)).fetchall()
    conn.close()
    
    res = []
    for r in rows:
        try:
            dt_obj = datetime.strptime(r['created_at'], '%Y-%m-%d %H:%M:%S')
        except:
            dt_obj = datetime.now()
        res.append({
            "description": r['description'], 
            "user_name": r['username'], 
            "user_initial": r['username'][0].upper(), 
            "time_ago": format_relative_time(dt_obj)
        })
    return jsonify({"activities": res})

@app.route('/api/appointments', methods=['GET'])
@login_required
def get_appointments():
    date = request.args.get('date')
    c = get_db()
    appts = c.execute("SELECT * FROM appointments WHERE date_str = ? AND pipeline_id = ?", (date, current_user.pipeline_id)).fetchall()
    c.close()
    
    return jsonify({"appointments": [{
        "id": a['id'], 
        "patient": a['patient_name'], 
        "doctor": a['doctor_name'], 
        "time": a['time_str'], 
        "note": a['notes'], 
        "color": a['color'], 
        "procedure": a['procedure'], 
        "duration": a['duration']
    } for a in appts]})

@app.route('/api/appointments/create', methods=['POST'])
@login_required
def create_appointment():
    data = request.json
    c = get_db()
    color = data.get('color', '#206aba')
    if not color:
        color = '#206aba'
    duration = data.get('duration', 30)
    procedure = data.get('procedure', '')

    c.execute(
        "INSERT INTO appointments (patient_name, doctor_name, date_str, time_str, notes, color, pipeline_id, procedure, duration) VALUES (?,?,?,?,?,?,?,?,?)", 
        (data['patient'], data['doctor'], data['date'], data['time'], data['note'], color, current_user.pipeline_id, procedure, duration)
    )
    c.commit()
    log_action(current_user.id, f"agendou consulta para <b>{data['patient']}</b> com <b>{data['doctor']}</b>", current_user.pipeline_id)
    c.close()
    return jsonify({"success": True})

@app.route('/api/appointments/update', methods=['POST'])
@login_required
def update_appointment_api():
    data = request.json
    c = get_db()
    color = data.get('color', '#206aba')
    duration = data.get('duration', 30)
    procedure = data.get('procedure', '')

    c.execute(
        "UPDATE appointments SET patient_name=?, notes=?, procedure=?, duration=?, color=? WHERE id=?", 
        (data['patient'], data['note'], procedure, duration, color, data['id'])
    )
    c.commit()
    log_action(current_user.id, f"editou agendamento de <b>{data['patient']}</b>", current_user.pipeline_id)
    c.close()
    return jsonify({"success": True})

@app.route('/api/appointments/delete', methods=['POST'])
@login_required
def delete_appointment_api():
    c = get_db()
    appt_id = request.json.get('id')
    appt = c.execute("SELECT patient_name, doctor_name FROM appointments WHERE id=?", (appt_id,)).fetchone()
    
    if appt:
        log_action(current_user.id, f"desmarcou consulta de <b>{appt['patient_name']}</b> com <b>{appt['doctor_name']}</b>", current_user.pipeline_id)
        
    c.execute("DELETE FROM appointments WHERE id = ?", (appt_id,))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/update_stage', methods=['POST'])
@login_required
def upd_stg(): 
    c = get_db()
    lid = request.json['id']
    new_status = request.json['status']
    
    lead = c.execute("SELECT name FROM leads WHERE id=?", (lid,)).fetchone()
    if lead:
        log_action(current_user.id, f"moveu <b>{lead['name']}</b> para a coluna <b>{new_status}</b>", current_user.pipeline_id)
        
    c.execute("UPDATE leads SET status=? WHERE id=?", (new_status, lid))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/delete_lead', methods=['POST'])
@login_required
def del_ld(): 
    c = get_db()
    lid = request.json['id']
    lead = c.execute("SELECT name FROM leads WHERE id=?", (lid,)).fetchone()
    
    if lead:
        log_action(current_user.id, f"removeu o lead <b>{lead['name']}</b> do sistema", current_user.pipeline_id)
        
    c.execute("DELETE FROM leads WHERE id=?", (lid,))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/lead/update_details', methods=['POST'])
@login_required
def update_lead_details():
    data = request.json
    conn = get_db()
    lead = conn.execute("SELECT name FROM leads WHERE id=?", (data['id'],)).fetchone()
    
    if lead:
        conn.execute("UPDATE leads SET name=?, value=? WHERE id=?", (data['name'], data['value'], data['id']))
        conn.commit()
        log_action(current_user.id, f"editou os detalhes de <b>{data['name']}</b>", current_user.pipeline_id)
        
    conn.close()
    return jsonify({"success": True})

@app.route('/api/instagram/connect', methods=['POST'])
@login_required
def connect_instagram():
    data = request.json
    token = data.get('token')
    if not token:
        return jsonify({"success": False, "error": "Token não fornecido."})
        
    try:
        params = {'fields': 'instagram_business_account,id,name', 'access_token': token}
        resp = requests.get(f"{GRAPH_URL}/me", params=params)
        data_me = resp.json()
        ig_page_id = None
        
        if 'instagram_business_account' in data_me:
            ig_page_id = data_me['instagram_business_account']['id']
        
        if not ig_page_id:
            if 'error' in data_me and data_me['error']['code'] == 100:
                pass
            resp_accounts = requests.get(f"{GRAPH_URL}/me/accounts", params={'access_token': token})
            data_accounts = resp_accounts.json()
            
            if 'error' in data_accounts:
                raise Exception(data_me.get('error', {}).get('message', data_accounts['error']['message']))
                
            pages = data_accounts.get('data', [])
            for page in pages:
                pid = page['id']
                p_resp = requests.get(f"{GRAPH_URL}/{pid}", params={'fields': 'instagram_business_account', 'access_token': token})
                p_data = p_resp.json()
                if 'instagram_business_account' in p_data:
                    ig_page_id = p_data['instagram_business_account']['id']
                    break

        if not ig_page_id:
            return jsonify({"success": False, "error": "Nenhuma conta Instagram Business encontrada vinculada."})
            
        conn = get_db()
        conn.execute("UPDATE users SET meta_token = ?, ig_page_id = ? WHERE id = ?", (token, ig_page_id, current_user.id))
        conn.commit()
        conn.close()
        
        log_action(current_user.id, "conectou uma conta do Instagram", current_user.pipeline_id)
        return jsonify({"success": True, "page_id": ig_page_id})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/start_fetch')
@login_required
def s_fetch(): 
    if not current_user.meta_token or not current_user.ig_page_id:
        return jsonify({"error": "Instagram não conectado (Token ausente)."})
        
    threading.Thread(target=worker_fetch_leads, args=(current_user.id, current_user.meta_token, current_user.ig_page_id)).start()
    return jsonify({"status": "started"})

@app.route('/api/get_candidates')
@login_required
def g_cand(): 
    d = USER_CACHES.get(current_user.id, {'loading': False, 'data': []})
    return jsonify({"loading": d.get('loading', False), "candidates": d.get('data', [])})

@app.route('/api/confirm_lead', methods=['POST'])
@login_required
def c_lead():
    d = request.json
    c = get_db()
    pid = current_user.pipeline_id
    exist = c.execute("SELECT id FROM leads WHERE username=? AND pipeline_id=?", (d['username'], pid)).fetchone()
    
    if exist: 
        c.execute(
            "UPDATE leads SET status=?,last_msg=?,profile_pic=?,last_interaction=? WHERE id=?",
            (d['target_stage'], d['last_msg'], d['profile_pic'], d['time_ago'], exist['id'])
        )
        log_action(current_user.id, f"atualizou dados de <b>{d['name']}</b>", pid)
    else: 
        c.execute(
            "INSERT INTO leads (name,username,last_msg,profile_pic,status,last_interaction,pipeline_id) VALUES (?,?,?,?,?,?,?)",
            (d['name'], d['username'], d['last_msg'], d['profile_pic'], d['target_stage'], d['time_ago'], pid)
        )
        log_action(current_user.id, f"adicionou <b>{d['name']}</b> em {d['target_stage']}", pid)
        
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/chat/threads')
@login_required
def chat_th():
    if not current_user.meta_token:
        return jsonify({"success": False, "error": "Instagram não conectado"})
        
    try:
        url = f"{GRAPH_URL}/{current_user.ig_page_id}/conversations"
        params = {'access_token': current_user.meta_token, 'limit': 15, 'fields': 'participants,updated_time,messages{message}'}
        resp = requests.get(url, params=params)
        data = resp.json()
        
        if 'error' in data:
            raise Exception(data['error']['message'])
            
        conversations = data.get('data', [])
        
        c = get_db()
        leads_q = c.execute("SELECT l.username,l.status,s.color FROM leads l JOIN stages s ON l.status=s.name AND l.pipeline_id=s.pipeline_id WHERE l.pipeline_id=?", (current_user.pipeline_id,)).fetchall()
        c.close()
        
        l_map = {r['username']: {'status': r['status'], 'color': r['color']} for r in leads_q}
        res = []
        
        for t in conversations:
            parts = t.get('participants', {}).get('data', [])
            u = parts[0] if parts else None
            if not u:
                continue
                
            last_msg = t.get('messages', {}).get('data', [{}])[0].get('message', '')
            res.append({
                "thread_id": t['id'], 
                "user": {
                    "name": u.get('name', 'User'), 
                    "username": u.get('username', 'user'), 
                    "pic": ""
                }, 
                "last_msg": last_msg[:40], 
                "lead_info": l_map.get(u.get('username', ''))
            })
            
        return jsonify({"success": True, "threads": res})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/chat/messages')
@login_required
def chat_ms():
    tid = request.args.get('thread_id')
    if not tid:
        return jsonify({"success": False})
        
    try:
        url = f"{GRAPH_URL}/{tid}/messages"
        params = {'access_token': current_user.meta_token, 'fields': 'message,from,created_time', 'limit': 20}
        resp = requests.get(url, params=params)
        data = resp.json()
        msgs = []
        
        for m in data.get('data', []):
            sender_id = m.get('from', {}).get('id')
            is_me = (sender_id == current_user.ig_page_id)
            msgs.append({
                "text": m.get('message', '[Mídia]'), 
                "is_sent_by_me": is_me
            })
            
        return jsonify({"success": True, "messages": msgs})
        
    except Exception as e:
        return jsonify({"success": False})

@app.route('/api/chat/send', methods=['POST'])
@login_required
def chat_sd():
    return jsonify({"success": False, "error": "Envio via API Oficial requer implementação complexa de IDs."})

if __name__ == '__main__':
    init_db()
    webbrowser.open("http://127.0.0.1:5000")
    app.run(debug=True, port=5000)