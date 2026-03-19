import sqlite3
import threading
import time
import json
import os
import random
import requests
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, redirect, url_for
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from instagrapi import Client as InstaClient
from instagrapi.exceptions import (
    ChallengeRequired, TwoFactorRequired, LoginRequired as InstaLoginRequired,
    BadPassword, PleaseWaitFewMinutes, FeedbackRequired,
    ClientError, ClientJSONDecodeError
)

# User-Agent realista para evitar detecção de servidor pelo Instagram
IG_USER_AGENT = (
    "Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; "
    "samsung; SM-S908B; b0q; qcom; pt_BR; 458229258)"
)
# Proxy opcional: defina via variável de ambiente IG_PROXY ou arquivo proxy.txt
# Exemplo: export IG_PROXY="http://user:pass@proxy.example.com:8080"
# Ou crie um arquivo proxy.txt na raiz do projeto com a URL do proxy
IG_PROXY = os.environ.get("IG_PROXY", "")
if not IG_PROXY:
    _proxy_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proxy.txt')
    if os.path.exists(_proxy_file):
        with open(_proxy_file, 'r') as f:
            IG_PROXY = f.read().strip()
        if IG_PROXY:
            print(f"[IG PROXY] Carregado de proxy.txt: {IG_PROXY[:30]}...")

# ==============================================================================
# CONFIGURAÇÕES E CONSTANTES
# ==============================================================================
app = Flask(__name__)
DB_NAME = "local_crm.db"

# Gerar/carregar secret_key persistente (nunca hardcoded)
_SECRET_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.flask_secret_key')
if os.path.exists(_SECRET_KEY_FILE):
    with open(_SECRET_KEY_FILE, 'r') as f:
        app.secret_key = f.read().strip()
else:
    import secrets
    _generated_key = secrets.token_hex(32)
    with open(_SECRET_KEY_FILE, 'w') as f:
        f.write(_generated_key)
    app.secret_key = _generated_key
    print(f"[SECURITY] Nova secret_key gerada e salva em {_SECRET_KEY_FILE}")

# Configuração de sessão segura
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)

# CORS — permite requisições do frontend Next.js (local + VPS)
CORS(app, resources={r"/api/*": {"origins": [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://136.248.105.0:3000",
]}}, supports_credentials=True)

# Rate Limiter — proteção contra brute force e abuso
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per minute"],
    storage_uri="memory://"
)

# URL BASE DA API DA META
GRAPH_URL = "https://graph.facebook.com/v18.0"

login_manager = LoginManager()
login_manager.init_app(app)

@login_manager.unauthorized_handler
def unauthorized_api():
    """Return JSON 401 for API requests instead of redirecting to login page."""
    return jsonify({"authenticated": False, "error": "Não autenticado"}), 401

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
    conn = sqlite3.connect(DB_NAME, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=15000")
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
            role TEXT DEFAULT 'tier1',
            cpf TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            FOREIGN KEY(pipeline_id) REFERENCES pipelines(id)
        )
    ''')

    # Migração: adicionar colunas role/cpf/phone se não existirem
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'tier1'")
    except:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN cpf TEXT DEFAULT ''")
    except:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")
    except:
        pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT ''")
    except:
        pass

    # Garantir que o usuário 'admin' tenha role 'admin'
    cursor.execute("UPDATE users SET role='admin' WHERE username='admin'")
    
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
        CREATE TABLE IF NOT EXISTS security_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            detail TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    # Tabela de respostas rápidas (canned responses)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS quick_replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    # Tabela para sessões do Instagram via Instagrapi
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS instagram_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            ig_username TEXT,
            session_data TEXT,
            connected INTEGER DEFAULT 0,
            connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    # Tabela de observações diárias para relatórios
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS report_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT DEFAULT '',
            pipeline_id INTEGER,
            UNIQUE(user_id, date, pipeline_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
        if 'pipeline_id' not in doc_cols:
            cursor.execute("ALTER TABLE doctors ADD COLUMN pipeline_id INTEGER DEFAULT 1")
            
        existing_lead_cols = [c[1] for c in cursor.execute("PRAGMA table_info(leads)")]
        if 'profile_pic' not in existing_lead_cols:
            cursor.execute("ALTER TABLE leads ADD COLUMN profile_pic TEXT")
        if 'created_at' not in existing_lead_cols:
            cursor.execute("ALTER TABLE leads ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP")
        if 'thread_id' not in existing_lead_cols:
            cursor.execute("ALTER TABLE leads ADD COLUMN thread_id TEXT")
        
        existing_user_cols = [c[1] for c in cursor.execute("PRAGMA table_info(users)")]
        if 'meta_token' not in existing_user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN meta_token TEXT")
        if 'ig_page_id' not in existing_user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN ig_page_id TEXT")
            
    except Exception as e:
        print(f"[DB WARN] Erro na verificação de migração: {e}")

    # --- MIGRAÇÃO: Separar usuários que compartilham pipeline_id=1 ---
    try:
        users_on_p1 = cursor.execute(
            "SELECT id, username, full_name FROM users WHERE pipeline_id = 1"
        ).fetchall()
        if len(users_on_p1) > 1:
            # Manter o primeiro usuário (admin/original) no pipeline 1
            # Criar pipelines exclusivos para os demais
            first_user_id = users_on_p1[0][0]
            for uid, uname, fname in users_on_p1[1:]:
                label = fname or uname
                cursor.execute("INSERT INTO pipelines (name) VALUES (?)", (f"Pipeline de {label}",))
                new_pid = cursor.execute("SELECT last_insert_rowid()").fetchone()[0]
                # Criar estágios padrão
                for idx, (sname, scolor) in enumerate(DEFAULT_STAGES):
                    cursor.execute(
                        "INSERT INTO stages (name, color, position, pipeline_id) VALUES (?, ?, ?, ?)",
                        (sname, scolor, idx, new_pid)
                    )
                cursor.execute(
                    "INSERT INTO stages (name, color, position, pipeline_id) VALUES (?, ?, ?, ?)",
                    ('FOLLOW UP', '#f59e0b', len(DEFAULT_STAGES), new_pid)
                )
                # Atualizar o usuário para o novo pipeline
                cursor.execute("UPDATE users SET pipeline_id = ? WHERE id = ?", (new_pid, uid))
                print(f"[DB MIGRATION] Usuário '{uname}' (id={uid}) migrado para pipeline {new_pid}")
    except Exception as e:
        print(f"[DB WARN] Erro na migração de pipelines: {e}")

    # --- MIGRAÇÃO: Rehash senhas em texto puro para werkzeug hash ---
    try:
        all_users = cursor.execute("SELECT id, username, password FROM users").fetchall()
        for uid, uname, pwd in all_users:
            if pwd and not pwd.startswith(('pbkdf2:', 'scrypt:')):
                hashed = generate_password_hash(pwd)
                cursor.execute("UPDATE users SET password = ? WHERE id = ?", (hashed, uid))
                print(f"[DB MIGRATION] Senha do usuário '{uname}' convertida para hash seguro")
    except Exception as e:
        print(f"[DB WARN] Erro na migração de senhas: {e}")

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

def security_log(action, detail="", user_id=None, username=None):
    """Registra ação crítica na tabela security_logs."""
    try:
        ip = request.remote_addr if request else "unknown"
        conn = get_db()
        conn.execute(
            "INSERT INTO security_logs (user_id, username, action, detail, ip_address) VALUES (?, ?, ?, ?, ?)",
            (user_id, username, action, detail, ip)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[SECURITY LOG ERROR] {e}")

class User(UserMixin):
    def __init__(self, id, username, password, meta_token, ig_page_id, pipeline_id, role='tier1'):
        self.id = id
        self.username = username
        self.password = password
        self.meta_token = meta_token
        self.ig_page_id = ig_page_id
        self.pipeline_id = pipeline_id
        self.role = role

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
        role = res['role'] if 'role' in res.keys() else ('admin' if res['username'] == 'admin' else 'tier1')
        return User(res['id'], res['username'], res['password'], token, page_id, res['pipeline_id'], role)
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
            
            pid = current_user.pipeline_id
            lead_db = conn_notif.execute("SELECT last_msg, unread_count FROM leads WHERE username=? AND pipeline_id=?", (username, pid)).fetchone()

            if lead_db and lead_db['last_msg'] != msg_text:
                new_count = (lead_db['unread_count'] or 0) + 1
                conn_notif.execute("UPDATE leads SET last_msg=?, unread_count=? WHERE username=? AND pipeline_id=?", (msg_text, new_count, username, pid))
            
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
# ROTAS API REST (V2 — Next.js Frontend)
# ==============================================================================
_LEGACY_TEMPLATE_REMOVED = True  # HTML_TEMPLATE removido — frontend agora é Next.js

# Rota raiz: retorna JSON informativo (o frontend roda em :3000)
@app.route('/')
def index():
    return jsonify({
        "app": "KeepMedica CRM API",
        "version": "2.0",
        "frontend": "http://localhost:3000",
        "status": "running"
    })

# --- API FINANCEIRO & ORÇAMENTOS (NOVA) ---
@app.route('/api/finance/data', methods=['GET'])
@login_required
def get_finance_data():
    c = get_db()
    pid = current_user.pipeline_id
    rows = c.execute("SELECT * FROM budgets WHERE pipeline_id=? ORDER BY created_at DESC", (pid,)).fetchall()
    c.close()

    budgets = [dict(r) for r in rows]
    # Normalizar status RECUSADO -> REJEITADO para o frontend V2
    for b in budgets:
        if b.get('status') == 'RECUSADO':
            b['status'] = 'REJEITADO'

    approved = sum(b['amount'] for b in budgets if b['status'] == 'APROVADO')
    pending = sum(b['amount'] for b in budgets if b['status'] == 'PENDENTE')
    rejected = sum(b['amount'] for b in budgets if b['status'] == 'REJEITADO')
    total = sum(b['amount'] for b in budgets)

    return jsonify({
        "faturamento": approved,
        "pendente": pending,
        "budgets": budgets,
        "kpis": {
            "approved": approved,
            "pending": pending,
            "rejected": rejected,
            "total": total
        }
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
    pid = current_user.pipeline_id
    budget = c.execute("SELECT patient_name FROM budgets WHERE id=? AND pipeline_id=?", (d['id'], pid)).fetchone()
    if not budget:
        c.close()
        return jsonify({"success": False, "error": "Orçamento não encontrado"}), 403

    c.execute("UPDATE budgets SET status=? WHERE id=? AND pipeline_id=?", (d['status'], d['id'], pid))
    status_text = "aprovou" if d['status'] == 'APROVADO' else "recusou"
    log_action(current_user.id, f"{status_text} o orçamento de {budget['patient_name']}", pid)
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/finance/budget/delete', methods=['POST'])
@login_required
def delete_budget():
    d = request.json
    c = get_db()
    pid = current_user.pipeline_id
    budget = c.execute("SELECT patient_name FROM budgets WHERE id=? AND pipeline_id=?", (d['id'], pid)).fetchone()
    if not budget:
        c.close()
        return jsonify({"success": False, "error": "Orçamento não encontrado"}), 403

    log_action(current_user.id, f"excluiu o orçamento de {budget['patient_name']}", pid)
    c.execute("DELETE FROM budgets WHERE id=? AND pipeline_id=?", (d['id'], pid))
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
@login_required
def adm_u():
    if getattr(current_user, 'role', '') != 'admin':
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    c = get_db()
    rows = c.execute("SELECT id, username, pipeline_id, role, cpf, phone, full_name FROM users").fetchall()
    u = []
    for r in rows:
        u.append({
            "id": r['id'],
            "username": r['username'],
            "full_name": r['full_name'] if 'full_name' in r.keys() else '',
            "pipeline_id": r['pipeline_id'],
            "role": r['role'] if 'role' in r.keys() else ('admin' if r['username'] == 'admin' else 'tier1'),
            "cpf": r['cpf'] if 'cpf' in r.keys() else '',
            "phone": r['phone'] if 'phone' in r.keys() else '',
        })
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
@login_required
def adm_du():
    if getattr(current_user, 'role', '') != 'admin':
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    c = get_db()
    uid = request.json['id']
    # Não permitir excluir a si mesmo
    if uid == current_user.id:
        c.close()
        return jsonify({"success": False, "error": "Não é possível excluir sua própria conta"}), 400
    # Limpar dados do pipeline do usuário excluído
    user_row = c.execute("SELECT pipeline_id FROM users WHERE id=?", (uid,)).fetchone()
    if user_row:
        upid = user_row['pipeline_id']
        c.execute("DELETE FROM leads WHERE pipeline_id=?", (upid,))
        c.execute("DELETE FROM appointments WHERE pipeline_id=?", (upid,))
        c.execute("DELETE FROM stages WHERE pipeline_id=?", (upid,))
        c.execute("DELETE FROM budgets WHERE pipeline_id=?", (upid,))
        c.execute("DELETE FROM activities WHERE pipeline_id=?", (upid,))
        c.execute("DELETE FROM doctors WHERE pipeline_id=?", (upid,))
        c.execute("DELETE FROM quick_replies WHERE user_id=?", (uid,))
        c.execute("DELETE FROM instagram_sessions WHERE user_id=?", (uid,))
        c.execute("DELETE FROM pipelines WHERE id=?", (upid,))
    c.execute("DELETE FROM users WHERE id=?", (uid,))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/admin/update_role', methods=['POST'])
@login_required
def adm_update_role():
    """Atualiza role, cpf e phone de um usuário. Apenas admin pode chamar."""
    if getattr(current_user, 'role', '') != 'admin':
        return jsonify({"success": False, "error": "Acesso negado"}), 403
    d = request.json
    uid = d.get('id')
    if not uid:
        return jsonify({"success": False, "error": "ID obrigatório"}), 400
    c = get_db()
    updates = []
    params = []
    if 'role' in d:
        if d['role'] not in ('admin', 'tier1', 'tier2'):
            c.close()
            return jsonify({"success": False, "error": "Role inválido"}), 400
        updates.append("role=?")
        params.append(d['role'])
        security_log("ROLE_CHANGE", f"Usuário id={uid} alterado para role='{d['role']}' por admin '{current_user.username}'", user_id=current_user.id, username=current_user.username)
    if 'cpf' in d:
        updates.append("cpf=?")
        params.append(d['cpf'])
    if 'phone' in d:
        updates.append("phone=?")
        params.append(d['phone'])
    if updates:
        params.append(uid)
        c.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
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
    pid = current_user.pipeline_id
    docs = [dict(r) for r in c.execute("SELECT * FROM doctors WHERE pipeline_id=?", (pid,)).fetchall()]
    c.close()
    return jsonify({"doctors": docs})

@app.route('/api/settings/doctors', methods=['POST'])
@login_required
def add_doctor_api():
    c = get_db()
    pid = current_user.pipeline_id
    c.execute("INSERT INTO doctors (name, pipeline_id) VALUES (?, ?)", (request.json['name'], pid))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/settings/doctors', methods=['PUT'])
@login_required
def update_doctor_api():
    d = request.json
    c = get_db()
    pid = current_user.pipeline_id
    if 'visible' in d:
        c.execute("UPDATE doctors SET visible=? WHERE id=? AND pipeline_id=?", (d['visible'], d['id'], pid))
    if 'name' in d:
        c.execute("UPDATE doctors SET name=? WHERE id=? AND pipeline_id=?", (d['name'], d['id'], pid))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/settings/doctors', methods=['DELETE'])
@login_required
def delete_doctor_api():
    c = get_db()
    pid = current_user.pipeline_id
    c.execute("DELETE FROM doctors WHERE id=? AND pipeline_id=?", (request.json['id'], pid))
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
        c.execute("UPDATE leads SET unread_count = 0 WHERE id = ? AND pipeline_id = ?", (lid, pid))
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
    pid = current_user.pipeline_id
    color = data.get('color', '#206aba')
    duration = data.get('duration', 30)
    procedure = data.get('procedure', '')

    c.execute(
        "UPDATE appointments SET patient_name=?, notes=?, procedure=?, duration=?, color=? WHERE id=? AND pipeline_id=?",
        (data['patient'], data['note'], procedure, duration, color, data['id'], pid)
    )
    c.commit()
    log_action(current_user.id, f"editou agendamento de <b>{data['patient']}</b>", pid)
    c.close()
    return jsonify({"success": True})

@app.route('/api/appointments/delete', methods=['POST'])
@login_required
def delete_appointment_api():
    c = get_db()
    pid = current_user.pipeline_id
    appt_id = request.json.get('id')
    appt = c.execute("SELECT patient_name, doctor_name FROM appointments WHERE id=? AND pipeline_id=?", (appt_id, pid)).fetchone()

    if not appt:
        c.close()
        return jsonify({"success": False, "error": "Agendamento não encontrado"}), 403

    log_action(current_user.id, f"desmarcou consulta de <b>{appt['patient_name']}</b> com <b>{appt['doctor_name']}</b>", pid)
    c.execute("DELETE FROM appointments WHERE id=? AND pipeline_id=?", (appt_id, pid))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/leads/create', methods=['POST'])
@login_required
def api_create_lead():
    d = request.json
    if not d or not d.get('name'):
        return jsonify({"success": False, "error": "Nome é obrigatório"}), 400

    c = get_db()
    pid = current_user.pipeline_id

    # Pega o primeiro estágio do pipeline como default
    first_stage = c.execute(
        "SELECT name FROM stages WHERE pipeline_id=? ORDER BY position ASC LIMIT 1", (pid,)
    ).fetchone()
    default_status = first_stage['name'] if first_stage else 'NOVOS'

    username = d.get('username', d['name'].lower().replace(' ', '_'))
    c.execute(
        "INSERT INTO leads (name, username, status, value, last_msg, pipeline_id, last_interaction) VALUES (?,?,?,?,?,?,datetime('now'))",
        (d['name'], username, d.get('status', default_status), d.get('value', 0), d.get('last_msg', ''), pid)
    )
    new_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    c.commit()

    log_action(current_user.id, f"adicionou o lead <b>{d['name']}</b>", pid)
    c.close()
    return jsonify({"success": True, "id": new_id})

@app.route('/update_stage', methods=['POST'])
@app.route('/api/update_stage', methods=['POST'])
@login_required
def upd_stg():
    c = get_db()
    lid = request.json['id']
    new_status = request.json['status']
    pid = current_user.pipeline_id

    lead = c.execute("SELECT name FROM leads WHERE id=? AND pipeline_id=?", (lid, pid)).fetchone()
    if not lead:
        c.close()
        return jsonify({"success": False, "error": "Lead não encontrado"}), 403

    log_action(current_user.id, f"moveu <b>{lead['name']}</b> para a coluna <b>{new_status}</b>", pid)
    c.execute("UPDATE leads SET status=? WHERE id=? AND pipeline_id=?", (new_status, lid, pid))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/delete_lead', methods=['POST'])
@app.route('/api/delete_lead', methods=['POST'])
@login_required
def del_ld():
    c = get_db()
    lid = request.json['id']
    pid = current_user.pipeline_id
    lead = c.execute("SELECT name FROM leads WHERE id=? AND pipeline_id=?", (lid, pid)).fetchone()

    if not lead:
        c.close()
        return jsonify({"success": False, "error": "Lead não encontrado"}), 403

    log_action(current_user.id, f"removeu o lead <b>{lead['name']}</b> do sistema", pid)
    security_log("DELETE_LEAD", f"Lead '{lead['name']}' (id={lid}) removido", user_id=current_user.id, username=current_user.username)
    c.execute("DELETE FROM leads WHERE id=? AND pipeline_id=?", (lid, pid))
    c.commit()
    c.close()
    return jsonify({"success": True})

@app.route('/api/lead/update_details', methods=['POST'])
@login_required
def update_lead_details():
    data = request.json
    conn = get_db()
    pid = current_user.pipeline_id
    lead = conn.execute("SELECT name FROM leads WHERE id=? AND pipeline_id=?", (data['id'], pid)).fetchone()

    if not lead:
        conn.close()
        return jsonify({"success": False, "error": "Lead não encontrado"}), 403

    conn.execute("UPDATE leads SET name=?, value=? WHERE id=? AND pipeline_id=?", (data['name'], data['value'], data['id'], pid))
    conn.commit()
    log_action(current_user.id, f"editou os detalhes de <b>{data['name']}</b>", pid)
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

# ==============================================================================
# ENDPOINTS EXCLUSIVOS PARA O FRONTEND NEXT.JS (V2)
# ==============================================================================

@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("10 per minute")
def api_auth_login():
    data = request.json
    if not data:
        return jsonify({"success": False, "error": "Dados inválidos"}), 400

    username = data.get('username', '')
    password = data.get('password', '')

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE username=?", (username,))
    u = cur.fetchone()
    conn.close()

    if u and check_password_hash(u['password'], password):
        role = u['role'] if 'role' in u.keys() else ('admin' if u['username'] == 'admin' else 'tier1')
        user_obj = User(u['id'], u['username'], u['password'], u['meta_token'], u['ig_page_id'], u['pipeline_id'], role)
        login_user(user_obj)
        security_log("LOGIN_SUCCESS", f"Usuário '{username}' autenticado", user_id=u['id'], username=username)
        return jsonify({
            "success": True,
            "user": {
                "id": u['id'],
                "username": u['username'],
                "role": role,
                "pipeline_id": u['pipeline_id'],
                "meta_token": u['meta_token'],
                "ig_page_id": u['ig_page_id']
            }
        })

    security_log("LOGIN_FAILED", f"Tentativa falha para '{username}'", username=username)
    return jsonify({"success": False, "error": "Usuário ou senha inválidos"}), 401


@app.route('/api/auth/register', methods=['POST'])
@limiter.limit("5 per minute")
def api_auth_register():
    data = request.json
    if not data:
        return jsonify({"success": False, "error": "Dados inválidos"}), 400

    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    full_name = (data.get('full_name') or '').strip()
    cpf = (data.get('cpf') or '').strip()
    phone = (data.get('phone') or '').strip()

    if not username or not password or not full_name:
        return jsonify({"success": False, "error": "Nome completo, perfil e senha são obrigatórios."}), 400

    conn = get_db()

    # Verificar duplicidade de username
    existing = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"success": False, "error": "Este nome de perfil já está em uso."}), 409

    # Verificar duplicidade de CPF (se informado)
    if cpf:
        existing_cpf = conn.execute("SELECT id FROM users WHERE cpf=? AND cpf != ''", (cpf,)).fetchone()
        if existing_cpf:
            conn.close()
            return jsonify({"success": False, "error": "Este CPF já está cadastrado."}), 409

    # Criar pipeline exclusivo para o novo usuário (multi-tenancy)
    hashed = generate_password_hash(password)
    conn.execute("INSERT INTO pipelines (name) VALUES (?)", (f"Pipeline de {full_name}",))
    new_pipeline_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    # Criar estágios padrão no pipeline do novo usuário
    for idx, (stage_name, color) in enumerate(DEFAULT_STAGES):
        conn.execute(
            "INSERT INTO stages (name, color, position, pipeline_id) VALUES (?, ?, ?, ?)",
            (stage_name, color, idx, new_pipeline_id)
        )

    # Criar coluna obrigatória FOLLOW UP
    conn.execute(
        "INSERT INTO stages (name, color, position, pipeline_id) VALUES (?, ?, ?, ?)",
        ('FOLLOW UP', '#f59e0b', len(DEFAULT_STAGES), new_pipeline_id)
    )

    # Criar usuário vinculado ao novo pipeline
    conn.execute(
        "INSERT INTO users (username, password, full_name, cpf, phone, role, pipeline_id) VALUES (?,?,?,?,?,?,?)",
        (username, hashed, full_name, cpf, phone, 'tier2', new_pipeline_id)
    )
    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "Conta criada com sucesso."})


@app.route('/api/auth/me', methods=['GET'])
def api_auth_me():
    if current_user.is_authenticated:
        return jsonify({
            "authenticated": True,
            "user": {
                "id": current_user.id,
                "username": current_user.username,
                "role": getattr(current_user, 'role', 'tier1'),
                "pipeline_id": current_user.pipeline_id,
                "meta_token": current_user.meta_token,
                "ig_page_id": current_user.ig_page_id
            }
        })
    return jsonify({"authenticated": False}), 401


@app.route('/api/auth/logout', methods=['POST'])
@login_required
def api_auth_logout():
    security_log("LOGOUT", f"Usuário '{current_user.username}' deslogou", user_id=current_user.id, username=current_user.username)
    logout_user()
    return jsonify({"success": True})


@app.route('/api/hub/metrics', methods=['GET'])
@login_required
def api_hub_metrics():
    c = get_db()
    pid = current_user.pipeline_id

    leads = c.execute("SELECT * FROM leads WHERE pipeline_id=?", (pid,)).fetchall()
    total_leads = len(leads)
    total_revenue = sum(l['value'] for l in leads if l['value'])

    total_appointments = c.execute(
        "SELECT count(*) as cnt FROM appointments WHERE pipeline_id=?", (pid,)
    ).fetchone()['cnt']

    active_pipelines = c.execute("SELECT count(*) as cnt FROM pipelines").fetchone()['cnt']

    c.close()
    return jsonify({
        "total_leads": total_leads,
        "total_revenue": total_revenue,
        "total_appointments": total_appointments,
        "active_pipelines": active_pipelines
    })


@app.route('/api/kanban/data', methods=['GET'])
@login_required
def api_kanban_data():
    c = get_db()
    pid = current_user.pipeline_id

    stages = [dict(r) for r in c.execute(
        "SELECT * FROM stages WHERE pipeline_id=? ORDER BY position ASC", (pid,)
    ).fetchall()]

    # Garantir que a coluna obrigatória "FOLLOW UP" exista
    stage_names_upper = [s['name'].upper() for s in stages]
    if 'FOLLOW UP' not in stage_names_upper:
        max_pos = max([s['position'] for s in stages], default=0)
        c.execute(
            "INSERT INTO stages (name, color, position, pipeline_id) VALUES (?, ?, ?, ?)",
            ('FOLLOW UP', '#f59e0b', max_pos + 1, pid)
        )
        c.commit()
        # Recarregar stages
        stages = [dict(r) for r in c.execute(
            "SELECT * FROM stages WHERE pipeline_id=? ORDER BY position ASC", (pid,)
        ).fetchall()]

    leads = [dict(r) for r in c.execute(
        "SELECT * FROM leads WHERE pipeline_id=?", (pid,)
    ).fetchall()]

    c.close()
    return jsonify({"stages": stages, "leads": leads})


@app.route('/api/kanban/sync_messages', methods=['POST'])
@login_required
def kanban_sync_messages():
    """Sincroniza last_msg de todos os leads com thread_id via Instagram API (leve)."""
    try:
        cl, _ = _get_instagram_client(current_user.id)
        if not cl:
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401

        pid = current_user.pipeline_id
        c = get_db()
        leads_with_thread = c.execute(
            "SELECT id, thread_id, last_msg, unread_count FROM leads WHERE thread_id IS NOT NULL AND thread_id != '' AND pipeline_id = ?",
            (pid,)
        ).fetchall()

        if not leads_with_thread:
            c.close()
            return jsonify({"success": True, "updated": 0})

        _humanize_delay()
        my_user_id = str(cl.user_id)
        raw = cl.private_request("direct_v2/inbox/", params={"limit": 40})
        threads = raw.get("inbox", {}).get("threads", [])

        # Mapear thread_id -> última mensagem
        thread_map = {}
        for t in threads:
            tid = str(t.get("thread_id", ""))
            items = t.get("items", [])
            if items:
                item = items[0]  # mais recente
                sender_id = str(item.get("user_id", ""))
                from_me = sender_id == my_user_id
                text = item.get("text", "")
                itype = item.get("item_type", "")
                if not text:
                    type_labels = {
                        "voice_media": "[Áudio]", "media": "[Foto]", "raven_media": "[Foto]",
                        "reel_share": "[Story]", "clip": "[Reels]", "animated_media": "[GIF]",
                        "like": "❤️", "link": "[Link]"
                    }
                    text = type_labels.get(itype, f"[{itype}]")
                thread_map[tid] = {"text": text, "from_me": from_me}

        updated = 0
        for lead in leads_with_thread:
            tid = str(lead['thread_id'])
            if tid in thread_map:
                new_text = thread_map[tid]["text"]
                old_text = lead['last_msg'] or ''
                if old_text != new_text:
                    new_unread = lead['unread_count'] or 0
                    if not thread_map[tid]["from_me"]:
                        new_unread += 1
                    c.execute(
                        "UPDATE leads SET last_msg = ?, unread_count = ?, last_interaction = datetime('now') WHERE id = ?",
                        (new_text, new_unread, lead['id'])
                    )
                    updated += 1

        c.commit()
        c.close()
        return jsonify({"success": True, "updated": updated})

    except (InstaLoginRequired, Exception) as e:
        print(f"[KANBAN SYNC] Erro: {e}")
        if _is_session_expired_error(e):
            _invalidate_instagram_session(current_user.id)
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/appointments/all', methods=['GET'])
@login_required
def api_appointments_all():
    c = get_db()
    pid = current_user.pipeline_id

    appts = c.execute(
        "SELECT * FROM appointments WHERE pipeline_id=?", (pid,)
    ).fetchall()

    doctors = c.execute("SELECT * FROM doctors WHERE pipeline_id=?", (pid,)).fetchall()
    c.close()

    return jsonify({
        "appointments": [{
            "id": a['id'],
            "patient_name": a['patient_name'],
            "doctor_name": a['doctor_name'],
            "date_str": a['date_str'],
            "time_str": a['time_str'],
            "notes": a['notes'] or '',
            "color": a['color'] or '#206aba',
            "pipeline_id": a['pipeline_id'],
            "procedure": a['procedure'] or '',
            "duration": a['duration'] or 30
        } for a in appts],
        "doctors": [dict(d) for d in doctors]
    })


@app.route('/api/reports/data', methods=['GET'])
@login_required
def api_reports_data():
    c = get_db()
    pid = current_user.pipeline_id

    # Leads por estágio
    stages = c.execute(
        "SELECT * FROM stages WHERE pipeline_id=? ORDER BY position ASC", (pid,)
    ).fetchall()

    leads = c.execute("SELECT * FROM leads WHERE pipeline_id=?", (pid,)).fetchall()
    total_leads = len(leads)

    funnel = []
    for s in stages:
        count = len([l for l in leads if l['status'] == s['name']])
        funnel.append({
            "stage": s['name'],
            "count": count,
            "color": s['color'],
            "percentage": round((count / total_leads * 100) if total_leads > 0 else 0)
        })

    # Revenue dos orçamentos aprovados
    budgets_approved = c.execute(
        "SELECT SUM(amount) as total FROM budgets WHERE pipeline_id=? AND status='APROVADO'", (pid,)
    ).fetchone()
    total_revenue = budgets_approved['total'] or 0

    c.close()

    return jsonify({
        "funnel": funnel,
        "kpis": {
            "total_leads": total_leads,
            "total_revenue": total_revenue,
            "cac": 85.0,
            "roi": 315.0
        }
    })


@app.route('/api/reports/daily_summary', methods=['GET'])
@login_required
def api_reports_daily_summary():
    """Relatório de performance diária baseado nos estágios do Kanban."""
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    c = get_db()
    pid = current_user.pipeline_id

    # Seller name
    seller_name = current_user.username

    # Doctor: buscar o primeiro médico visível vinculado
    doctor_row = c.execute("SELECT name FROM doctors WHERE visible=1 AND pipeline_id=? ORDER BY id ASC LIMIT 1", (pid,)).fetchone()
    doctor_name = doctor_row['name'] if doctor_row else 'Não configurado'

    # Instagram connected username (se houver)
    ig_row = c.execute(
        "SELECT ig_username FROM instagram_sessions WHERE user_id=? AND connected=1", (current_user.id,)
    ).fetchone()
    ig_username = ig_row['ig_username'] if ig_row else ''

    # Todos os stages do pipeline
    stages = c.execute("SELECT name FROM stages WHERE pipeline_id=? ORDER BY position ASC", (pid,)).fetchall()
    stage_names = [s['name'] for s in stages]

    # Leads criados nesta data
    leads_today = c.execute(
        "SELECT id, status FROM leads WHERE pipeline_id=? AND DATE(created_at)=?",
        (pid, date_str)
    ).fetchall()

    # Todos os leads do pipeline (para contagem por status geral)
    all_leads = c.execute(
        "SELECT id, status, created_at FROM leads WHERE pipeline_id=?", (pid,)
    ).fetchall()

    # Normalizar nomes de estágio para comparação (uppercase, sem acentos simplificado)
    def normalize(s):
        return (s or '').strip().upper()

    # Contagens baseadas nos estágios
    leads_today_count = len(leads_today)

    # Ativações: leads criados na data (entraram no pipeline nesse dia)
    ativacoes = leads_today_count

    # Respostas: leads criados na data que estão em estágios de qualificação/proposta
    response_stages = {'QUALIFICACAO', 'QUALIFICAÇÃO', 'PROPOSTA', 'PROPOSTAS'}
    respostas = sum(1 for l in leads_today if normalize(l['status']) in response_stages)

    # Follow-ups: leads no estágio FOLLOW UP
    follow_stages = {'FOLLOW UP', 'FOLLOWUP', 'FOLLOW-UP', 'FOLLOW'}
    follows = sum(1 for l in all_leads if normalize(l['status']) in follow_stages and l['created_at'] and l['created_at'][:10] == date_str)

    # Conversão: leads em NEGOCIAÇÃO ou GANHO
    conversion_stages = {'NEGOCIACAO', 'NEGOCIAÇÃO', 'GANHO', 'GANHOS', 'FECHADO', 'CONVERTIDO'}
    conversoes = sum(1 for l in leads_today if normalize(l['status']) in conversion_stages)

    # Taxas (proteção contra divisão por zero)
    taxa_resposta = round((respostas / ativacoes * 100), 1) if ativacoes > 0 else 0
    taxa_conversao = round((conversoes / ativacoes * 100), 1) if ativacoes > 0 else 0

    # Receita do dia (orçamentos aprovados)
    revenue_row = c.execute(
        "SELECT SUM(amount) as total FROM budgets WHERE pipeline_id=? AND status='APROVADO' AND DATE(created_at)=?",
        (pid, date_str)
    ).fetchone()
    receita_dia = revenue_row['total'] or 0 if revenue_row else 0

    # Funnel completo do dia (para cada estágio, contar leads criados nessa data)
    funnel = []
    for sn in stage_names:
        count = sum(1 for l in leads_today if normalize(l['status']) == normalize(sn))
        funnel.append({"stage": sn, "count": count})

    # Observações do dia
    note_row = c.execute(
        "SELECT notes FROM report_notes WHERE user_id=? AND date=? AND pipeline_id=?",
        (current_user.id, date_str, pid)
    ).fetchone()
    observations = note_row['notes'] if note_row else ''

    c.close()

    return jsonify({
        "success": True,
        "date": date_str,
        "seller": seller_name,
        "doctor": doctor_name,
        "ig_username": ig_username,
        "ativacoes": ativacoes,
        "respostas": respostas,
        "taxa_resposta": taxa_resposta,
        "follows": follows,
        "conversoes": conversoes,
        "taxa_conversao": taxa_conversao,
        "receita_dia": receita_dia,
        "funnel": funnel,
        "observations": observations,
        "stage_names": stage_names
    })


@app.route('/api/reports/save_notes', methods=['POST'])
@login_required
def api_reports_save_notes():
    """Salvar observações do relatório diário."""
    d = request.get_json()
    date_str = d.get('date', datetime.now().strftime('%Y-%m-%d'))
    notes = d.get('notes', '')
    pid = current_user.pipeline_id

    c = get_db()
    existing = c.execute(
        "SELECT id FROM report_notes WHERE user_id=? AND date=? AND pipeline_id=?",
        (current_user.id, date_str, pid)
    ).fetchone()

    if existing:
        c.execute("UPDATE report_notes SET notes=? WHERE id=?", (notes, existing['id']))
    else:
        c.execute(
            "INSERT INTO report_notes (user_id, date, notes, pipeline_id) VALUES (?,?,?,?)",
            (current_user.id, date_str, notes, pid)
        )
    c.commit()
    c.close()
    return jsonify({"success": True})


# ==============================================================================
# INSTAGRAM VIA INSTAGRAPI — LOGIN COM CHALLENGE / 2FA
# ==============================================================================
# Armazena instâncias temporárias de InstaClient enquanto aguardam código de verificação
PENDING_INSTA_CLIENTS = {}

def _create_instagram_client():
    """Cria um InstaClient configurado com User-Agent realista e proxy opcional."""
    cl = InstaClient()
    cl.delay_range = [2, 5]
    # Configurações de dispositivo Android real para evitar detecção
    cl.set_user_agent(IG_USER_AGENT)
    cl.set_device({
        "app_version": "275.0.0.27.98",
        "android_version": 33,
        "android_release": "13.0",
        "dpi": "420dpi",
        "resolution": "1080x2400",
        "manufacturer": "samsung",
        "device": "SM-S908B",
        "model": "b0q",
        "cpu": "qcom",
        "version_code": "458229258",
    })
    cl.set_country("BR")
    cl.set_country_code(55)
    cl.set_locale("pt_BR")
    cl.set_timezone_offset(-10800)  # UTC-3 (Brasília)
    # Proxy residencial (se configurado) para IPs bloqueados
    # Recarregar proxy.txt em runtime (permite alterar sem reiniciar)
    proxy = IG_PROXY
    if not proxy:
        _proxy_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proxy.txt')
        if os.path.exists(_proxy_file):
            with open(_proxy_file, 'r') as f:
                proxy = f.read().strip()
    if proxy:
        cl.set_proxy(proxy)
        print(f"[IG CLIENT] Usando proxy: {proxy[:30]}...")
    return cl


def _parse_instagram_error(e):
    """Analisa erro do Instagram e retorna mensagem amigável em PT-BR."""
    err_str = str(e).lower()
    raw = getattr(e, 'response', None)
    raw_text = ''
    if raw is not None:
        try:
            raw_text = raw.text[:500] if hasattr(raw, 'text') else str(raw)[:500]
        except Exception:
            pass

    print(f"[IG ERROR] Tipo: {type(e).__name__} | Msg: {str(e)[:200]} | Raw: {raw_text[:200]}")

    if 'blacklist' in err_str or 'ip' in err_str:
        return "Seu IP foi bloqueado pelo Instagram. Configure um proxy residencial no arquivo proxy.txt ou use uma rede diferente."
    if "can't find" in err_str or 'cant find' in err_str or 'cannot find' in err_str or 'user_not_found' in err_str:
        return ("O Instagram bloqueou este IP de datacenter (VPS/cloud). "
                "Isso não é erro de usuário/senha. "
                "Configure um proxy residencial no arquivo proxy.txt na raiz do projeto "
                "ou faça login a partir de uma rede residencial.")
    if 'bad_password' in err_str or 'invalid' in err_str:
        return "Usuário ou senha incorretos. Verifique suas credenciais."
    if 'please wait' in err_str or 'few minutes' in err_str:
        return "O Instagram pediu para aguardar alguns minutos antes de tentar novamente."
    if 'feedback_required' in err_str:
        return "O Instagram bloqueou temporariamente esta ação. Abra o app do Instagram e resolva o aviso."
    if 'checkpoint' in err_str or 'challenge' in err_str:
        return None  # Sinaliza que é um challenge, tratado separadamente
    if 'expecting value' in err_str or 'json' in err_str:
        return "O Instagram retornou uma resposta inválida (possível Captcha ou bloqueio temporário). Tente novamente em 10 minutos ou use outra rede."
    if 'login_required' in err_str or '401' in err_str or 'unauthorized' in err_str:
        return "Sessão expirada. Faça login novamente."
    if 'linked facebook' in err_str:
        return "Esta conta usa login pelo Facebook. Tente fazer login pelo Facebook no app do Instagram primeiro, depois tente novamente aqui."
    return None  # Erro não mapeado


@app.route('/api/instagram/login', methods=['POST'])
@login_required
def instagram_login():
    """
    Passo 1: Tenta login no Instagram.
    1. Tenta restaurar sessão salva
    2. Se não tem sessão, faz login novo com User-Agent e delay humanizado
    3. Captura ChallengeRequired, TwoFactorRequired, IP blacklist, e outros erros
    """
    data = request.json
    ig_username = (data.get('username') or '').strip()
    ig_password = data.get('password') or ''

    if not ig_username or not ig_password:
        return jsonify({"success": False, "error": "Usuário e senha são obrigatórios."}), 400

    # --- Tentar restaurar sessão existente antes de fazer login novo ---
    conn = get_db()
    saved = conn.execute(
        "SELECT session_data, ig_username FROM instagram_sessions WHERE user_id = ? AND connected = 1",
        (current_user.id,)
    ).fetchone()
    conn.close()

    if saved and saved['session_data'] and saved['ig_username'] == ig_username:
        try:
            cl = _create_instagram_client()
            cl.set_settings(json.loads(saved['session_data']))
            session_id = cl.settings.get('authorization_data', {}).get('sessionid', '')
            if session_id:
                cl.login_by_sessionid(session_id)
                print(f"[IG LOGIN] Sessão restaurada com sucesso para @{ig_username}")
                _save_instagram_session(current_user.id, ig_username, cl)
                return jsonify({"success": True, "status": "connected", "ig_username": ig_username})
        except Exception as e:
            print(f"[IG LOGIN] Sessão salva inválida, fazendo login novo: {e}")
            _invalidate_instagram_session(current_user.id)

    # --- Login novo com delays humanizados ---
    cl = _create_instagram_client()
    print(f"[IG LOGIN] Iniciando login para @{ig_username}...")
    time.sleep(random.uniform(1.5, 3.0))  # Delay pré-login

    try:
        cl.login(ig_username, ig_password)

        # Verificar se last_json contém challenge mesmo após login "bem-sucedido"
        last = getattr(cl, 'last_json', {}) or {}
        if last.get('message') == 'challenge_required' or last.get('challenge'):
            print(f"[IG LOGIN] Challenge detectado pós-login para @{ig_username}")
            challenge_url = last.get('challenge', {}).get('api_path', '')
            PENDING_INSTA_CLIENTS[current_user.id] = {
                "client": cl, "username": ig_username, "challenge_url": challenge_url
            }
            return jsonify({
                "success": True,
                "status": "challenge_required",
                "message": "O Instagram enviou um código de verificação para o seu e-mail/telefone."
            })

        # Login direto sem challenge — salvar sessão imediatamente
        _save_instagram_session(current_user.id, ig_username, cl)
        log_action(current_user.id, f"conectou o Instagram <b>@{ig_username}</b>", current_user.pipeline_id)
        print(f"[IG LOGIN] Login bem-sucedido para @{ig_username}")
        return jsonify({"success": True, "status": "connected", "ig_username": ig_username})

    except ChallengeRequired as e:
        print(f"[IG LOGIN] ChallengeRequired para @{ig_username}: {e}")
        challenge_url = ''
        last = getattr(cl, 'last_json', {}) or {}
        if last.get('challenge'):
            challenge_url = last['challenge'].get('api_path', '')
        PENDING_INSTA_CLIENTS[current_user.id] = {
            "client": cl, "username": ig_username, "challenge_url": challenge_url
        }
        return jsonify({
            "success": True,
            "status": "challenge_required",
            "message": "O Instagram enviou um código de verificação para o seu e-mail/telefone."
        })

    except TwoFactorRequired as e:
        print(f"[IG LOGIN] TwoFactorRequired para @{ig_username}: {e}")
        PENDING_INSTA_CLIENTS[current_user.id] = {"client": cl, "username": ig_username}
        return jsonify({
            "success": True,
            "status": "two_factor_required",
            "message": "Autenticação de dois fatores ativada. Insira o código do app autenticador."
        })

    except BadPassword:
        return jsonify({"success": False, "error": "Usuário ou senha incorretos."}), 401

    except PleaseWaitFewMinutes:
        return jsonify({"success": False, "error": "O Instagram pediu para aguardar alguns minutos. Tente novamente depois."}), 429

    except FeedbackRequired:
        return jsonify({"success": False, "error": "O Instagram bloqueou temporariamente esta ação. Abra o app do Instagram e resolva o aviso."}), 429

    except (ClientJSONDecodeError, Exception) as e:
        error_msg = str(e)
        print(f"[IG LOGIN] Erro para @{ig_username}: {type(e).__name__}: {error_msg}")

        # Tentar interpretar o erro com mensagem amigável
        friendly = _parse_instagram_error(e)

        # Challenge escondido em exceções genéricas
        if friendly is None and ("challenge" in error_msg.lower() or "checkpoint" in error_msg.lower()):
            PENDING_INSTA_CLIENTS[current_user.id] = {"client": cl, "username": ig_username}
            return jsonify({
                "success": True,
                "status": "challenge_required",
                "message": "O Instagram exige verificação. Insira o código enviado para o seu e-mail."
            })

        final_msg = friendly or f"Erro ao conectar: {error_msg}"
        status_code = 429 if 'wait' in error_msg.lower() or 'blacklist' in error_msg.lower() else 500
        return jsonify({"success": False, "error": final_msg}), status_code


@app.route('/api/instagram/verify', methods=['POST'])
@login_required
def instagram_verify():
    """
    Passo 2: Recebe o código de verificação e finaliza o login.
    """
    data = request.json
    code = str(data.get('code') or '').strip()

    if not code:
        return jsonify({"success": False, "error": "Código de verificação é obrigatório."}), 400

    pending = PENDING_INSTA_CLIENTS.get(current_user.id)
    if not pending:
        return jsonify({"success": False, "error": "Nenhuma sessão pendente. Refaça o login."}), 400

    cl = pending["client"]
    ig_username = pending["username"]

    try:
        cl.challenge_code_handler = lambda username, choice: code
        cl.challenge_resolve(cl.last_json)
        # Sessão resolvida — salvar
        _save_instagram_session(current_user.id, ig_username, cl)
        PENDING_INSTA_CLIENTS.pop(current_user.id, None)
        log_action(current_user.id, f"verificou e conectou o Instagram <b>@{ig_username}</b>", current_user.pipeline_id)
        return jsonify({"success": True, "status": "connected", "ig_username": ig_username})

    except Exception as e:
        return jsonify({"success": False, "error": f"Código inválido ou expirado: {str(e)}"}), 400


@app.route('/api/instagram/status')
@login_required
def instagram_status():
    """Verifica se o usuário já tem uma sessão Instagram ativa."""
    conn = get_db()
    row = conn.execute(
        "SELECT ig_username, connected FROM instagram_sessions WHERE user_id = ?",
        (current_user.id,)
    ).fetchone()
    conn.close()

    if row and row['connected']:
        return jsonify({"connected": True, "ig_username": row['ig_username']})
    return jsonify({"connected": False})


@app.route('/api/instagram/proxy', methods=['GET', 'POST'])
@login_required
def instagram_proxy():
    """GET: retorna proxy configurado. POST: salva proxy no arquivo proxy.txt."""
    global IG_PROXY
    proxy_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proxy.txt')

    if request.method == 'GET':
        proxy = IG_PROXY
        if not proxy and os.path.exists(proxy_file):
            with open(proxy_file, 'r') as f:
                proxy = f.read().strip()
        return jsonify({"proxy": proxy[:30] + "..." if len(proxy) > 30 else proxy, "configured": bool(proxy)})

    # POST — salvar proxy
    data = request.json
    proxy_url = (data.get('proxy') or '').strip()
    with open(proxy_file, 'w') as f:
        f.write(proxy_url)
    IG_PROXY = proxy_url
    if proxy_url:
        print(f"[IG PROXY] Proxy configurado via API: {proxy_url[:30]}...")
    else:
        print("[IG PROXY] Proxy removido via API.")
    return jsonify({"success": True, "configured": bool(proxy_url)})


@app.route('/api/instagram/export_session', methods=['GET'])
@login_required
def instagram_export_session():
    """Exporta a sessão Instagram para transferir para outra máquina (ex: VPS)."""
    conn = get_db()
    row = conn.execute(
        "SELECT ig_username, session_data FROM instagram_sessions WHERE user_id = ? AND connected = 1",
        (current_user.id,)
    ).fetchone()
    conn.close()
    if not row or not row['session_data']:
        return jsonify({"success": False, "error": "Nenhuma sessão Instagram ativa para exportar."}), 404
    import base64
    token = base64.b64encode(json.dumps({
        "ig_username": row['ig_username'],
        "session_data": row['session_data']
    }).encode()).decode()
    return jsonify({"success": True, "token": token, "ig_username": row['ig_username']})


@app.route('/api/instagram/import_session', methods=['POST'])
@login_required
def instagram_import_session():
    """Importa uma sessão Instagram exportada de outra máquina."""
    data = request.json
    token = (data.get('token') or '').strip()
    if not token:
        return jsonify({"success": False, "error": "Token de sessão é obrigatório."}), 400
    try:
        import base64
        payload = json.loads(base64.b64decode(token).decode())
        ig_username = payload['ig_username']
        session_data = payload['session_data']
        # Validar que a sessão contém dados reais
        settings = json.loads(session_data)
        if not settings.get('authorization_data', {}).get('sessionid'):
            return jsonify({"success": False, "error": "Token de sessão inválido ou corrompido."}), 400
        # Salvar sessão no banco
        conn = get_db()
        existing = conn.execute("SELECT id FROM instagram_sessions WHERE user_id = ?", (current_user.id,)).fetchone()
        now = datetime.now().isoformat()
        if existing:
            conn.execute(
                "UPDATE instagram_sessions SET ig_username=?, session_data=?, connected=1, connected_at=? WHERE user_id=?",
                (ig_username, session_data, now, current_user.id)
            )
        else:
            conn.execute(
                "INSERT INTO instagram_sessions (user_id, ig_username, session_data, connected) VALUES (?, ?, ?, 1)",
                (current_user.id, ig_username, session_data)
            )
        conn.commit()
        conn.close()
        log_action(current_user.id, f"importou sessão do Instagram <b>@{ig_username}</b>", current_user.pipeline_id)
        return jsonify({"success": True, "ig_username": ig_username})
    except (json.JSONDecodeError, KeyError, Exception) as e:
        return jsonify({"success": False, "error": f"Token inválido: {str(e)}"}), 400


@app.route('/api/instagram/disconnect', methods=['POST'])
@login_required
def instagram_disconnect():
    """Desconecta a sessão Instagram do usuário."""
    conn = get_db()
    conn.execute("DELETE FROM instagram_sessions WHERE user_id = ?", (current_user.id,))
    conn.commit()
    conn.close()
    PENDING_INSTA_CLIENTS.pop(current_user.id, None)
    log_action(current_user.id, "desconectou o Instagram", current_user.pipeline_id)
    return jsonify({"success": True})


def _is_session_expired_error(e):
    """Verifica se um erro indica sessão expirada (401/LoginRequired)."""
    err_str = str(e).lower()
    return any(k in err_str for k in ['401', 'login_required', 'unauthorized', 'challenge_required'])


def _humanize_delay():
    """Delay aleatório de 1-3s para simular comportamento humano e evitar bloqueios."""
    time.sleep(random.uniform(1.0, 3.0))


def _save_instagram_session(user_id, ig_username, cl):
    """Persiste a sessão do instagrapi no banco SQLite."""
    session_data = json.dumps(cl.get_settings())
    conn = get_db()
    existing = conn.execute("SELECT id FROM instagram_sessions WHERE user_id = ?", (user_id,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE instagram_sessions SET ig_username=?, session_data=?, connected=1, connected_at=? WHERE user_id=?",
            (ig_username, session_data, datetime.now().isoformat(), user_id)
        )
    else:
        conn.execute(
            "INSERT INTO instagram_sessions (user_id, ig_username, session_data, connected) VALUES (?, ?, ?, 1)",
            (user_id, ig_username, session_data)
        )
    conn.commit()
    conn.close()


def _get_instagram_client(user_id):
    """Restaura um InstaClient autenticado a partir da sessão salva no banco.
    Valida a sessão e marca como desconectado se expirou (401)."""
    conn = get_db()
    row = conn.execute(
        "SELECT session_data, ig_username FROM instagram_sessions WHERE user_id = ? AND connected = 1",
        (user_id,)
    ).fetchone()
    conn.close()
    if not row or not row['session_data']:
        return None, None

    cl = _create_instagram_client()
    try:
        cl.set_settings(json.loads(row['session_data']))
        session_id = cl.settings.get('authorization_data', {}).get('sessionid', '')
        if not session_id:
            _invalidate_instagram_session(user_id)
            return None, None
        cl.login_by_sessionid(session_id)
        # Atualizar sessão com possíveis cookies renovados
        _save_instagram_session(user_id, row['ig_username'], cl)
        return cl, row['ig_username']
    except Exception as e:
        err_str = str(e).lower()
        if '401' in err_str or 'login_required' in err_str or 'unauthorized' in err_str or 'challenge' in err_str:
            print(f"[IG SESSION] Sessão expirada para user {user_id}: {e}")
            _invalidate_instagram_session(user_id)
            return None, None
        # Outro erro — tentar retornar o client mesmo assim
        print(f"[IG SESSION] Erro não-fatal ao restaurar sessão: {e}")
        return cl, row['ig_username']


def _invalidate_instagram_session(user_id):
    """Marca a sessão do Instagram como desconectada no banco."""
    try:
        conn = get_db()
        conn.execute(
            "UPDATE instagram_sessions SET connected=0, session_data='' WHERE user_id=?",
            (user_id,)
        )
        conn.commit()
        conn.close()
        print(f"[IG SESSION] Sessão invalidada para user {user_id}")
    except Exception as e:
        print(f"[IG SESSION] Erro ao invalidar sessão: {e}")


@app.route('/api/instagram/threads')
@login_required
def instagram_threads():
    """Busca as últimas conversas do Direct do Instagram."""
    try:
        cl, ig_username = _get_instagram_client(current_user.id)
        if not cl:
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401

        _humanize_delay()
        raw = cl.private_request("direct_v2/inbox/", params={"limit": 20})
        inbox = raw.get("inbox", {})
        raw_threads = inbox.get("threads", [])

        result = []
        for t in raw_threads:
            # Extrair usuários da thread (excluir o próprio)
            users = t.get("users", [])
            other_users = [u for u in users if u.get("username") != ig_username]
            if not other_users:
                continue
            user = other_users[0]

            # Última mensagem
            last_message = ''
            items = t.get("items", [])
            if items:
                item = items[0]
                if item.get("text"):
                    last_message = item["text"]
                elif item.get("item_type"):
                    last_message = f'[{item["item_type"]}]'

            result.append({
                "thread_id": str(t.get("thread_id", "")),
                "user_id": str(user.get("pk", "")),
                "username": user.get("username", ""),
                "full_name": user.get("full_name") or user.get("username", ""),
                "profile_pic": user.get("profile_pic_url", ""),
                "last_message": last_message,
            })

        return jsonify({"success": True, "threads": result})

    except (InstaLoginRequired, ClientJSONDecodeError, Exception) as e:
        print(f"[IG THREADS] Erro: {type(e).__name__}: {str(e)[:200]}")
        if _is_session_expired_error(e):
            _invalidate_instagram_session(current_user.id)
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401
        friendly = _parse_instagram_error(e)
        return jsonify({
            "success": False,
            "error": friendly or f"Erro ao buscar conversas: {str(e)}"
        }), 500


@app.route('/api/instagram/import', methods=['POST'])
@login_required
def instagram_import():
    """Importa threads selecionadas como leads no primeiro estágio do Kanban."""
    data = request.json
    thread_items = data.get('threads', [])

    if not thread_items:
        return jsonify({"success": False, "error": "Nenhuma conversa selecionada."}), 400

    try:
        conn = get_db()
        pid = current_user.pipeline_id

        # Buscar o primeiro estágio (NOVOS) do pipeline do usuário
        first_stage = conn.execute(
            "SELECT name FROM stages WHERE pipeline_id = ? ORDER BY position ASC LIMIT 1",
            (pid,)
        ).fetchone()
        stage_name = first_stage['name'] if first_stage else 'NOVOS'

        imported = 0
        skipped = 0
        for item in thread_items:
            username = item.get('username', '')
            full_name = item.get('full_name', username)
            profile_pic = item.get('profile_pic', '')
            last_message = item.get('last_message', '')
            thread_id = item.get('thread_id', '')

            # Verificar se já existe um lead com este username no pipeline
            existing = conn.execute(
                "SELECT id FROM leads WHERE username = ? AND pipeline_id = ?",
                (username, pid)
            ).fetchone()

            if existing:
                skipped += 1
                continue

            conn.execute(
                "INSERT INTO leads (name, username, status, last_msg, profile_pic, pipeline_id, value, thread_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                (full_name, username, stage_name, last_message, profile_pic, pid, thread_id)
            )
            imported += 1

        conn.commit()
        conn.close()

        if imported > 0:
            log_action(current_user.id, f"importou <b>{imported}</b> lead(s) do Instagram", pid)

        return jsonify({
            "success": True,
            "imported": imported,
            "skipped": skipped,
            "message": f"{imported} lead(s) importado(s) com sucesso." + (f" {skipped} já existente(s)." if skipped else "")
        })

    except Exception as e:
        return jsonify({"success": False, "error": f"Erro na importação: {str(e)}"}), 500


@app.route('/api/instagram/messages/<thread_id>')
@login_required
def instagram_messages(thread_id):
    """Busca mensagens de uma thread específica do Direct."""
    try:
        cl, ig_username = _get_instagram_client(current_user.id)
        if not cl:
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401

        _humanize_delay()
        raw = cl.private_request(f"direct_v2/threads/{thread_id}/", params={"limit": 50})
        thread_data = raw.get("thread", {})
        items = thread_data.get("items", [])

        # Obter o user_id do usuário logado
        my_user_id = str(cl.user_id)

        messages = []
        for item in items:
            sender_id = str(item.get("user_id", ""))
            from_me = sender_id == my_user_id
            msg_text = item.get("text", "")
            item_type = item.get("item_type", "")
            timestamp = item.get("timestamp", "")

            # Converter timestamp de microsegundos para ISO
            time_str = ""
            if timestamp:
                try:
                    ts = int(timestamp) / 1_000_000
                    time_str = datetime.fromtimestamp(ts).strftime("%H:%M")
                except (ValueError, OSError):
                    time_str = ""

            # Tratar tipos de mensagem
            media_url = ""
            story_url = ""
            story_text = ""

            if item_type == "text":
                pass  # msg_text já está preenchido
            elif item_type == "raven_media" or item_type == "media":
                media_data = item.get("media", {}) or item.get("visual_media", {}).get("media", {})
                if media_data:
                    img_candidates = media_data.get("image_versions2", {}).get("candidates", [])
                    if img_candidates:
                        media_url = img_candidates[0].get("url", "")
                if not msg_text:
                    msg_text = "[Foto]" if not media_url else ""
            elif item_type == "reel_share":
                reel = item.get("reel_share", {})
                story_text = reel.get("text", "")
                reel_media = reel.get("media", {})
                if reel_media:
                    img_candidates = reel_media.get("image_versions2", {}).get("candidates", [])
                    if img_candidates:
                        story_url = img_candidates[0].get("url", "")
                if not msg_text:
                    msg_text = story_text or "[Resposta a Story]"
            elif item_type == "clip":
                msg_text = msg_text or "[Reels]"
            elif item_type == "voice_media":
                voice_data = item.get("voice_media", {}).get("media", {})
                audio_candidates = voice_data.get("audio", {})
                if isinstance(audio_candidates, dict):
                    media_url = audio_candidates.get("audio_src", "")
                if not media_url:
                    # Fallback: sometimes the URL is at a different path
                    media_url = voice_data.get("audio_src", "")
                msg_text = msg_text or "[Áudio]"
            elif item_type == "animated_media":
                msg_text = msg_text or "[GIF]"
            elif item_type == "link":
                link_data = item.get("link", {})
                msg_text = msg_text or link_data.get("text", "[Link]")
            elif item_type == "like":
                msg_text = "❤️"
            elif item_type == "action_log":
                action = item.get("action_log", {})
                msg_text = action.get("description", "[Ação]")
            else:
                if not msg_text:
                    msg_text = f"[{item_type}]"

            messages.append({
                "id": item.get("item_id", ""),
                "text": msg_text,
                "from_me": from_me,
                "timestamp": time_str,
                "item_type": item_type,
                "media_url": media_url,
                "story_url": story_url,
                "story_text": story_text,
            })

        # Inverter para ordem cronológica (mais antigos primeiro)
        messages.reverse()

        # Atualizar last_msg e unread_count no banco para o lead vinculado a esta thread
        if messages:
            last_msg_text = messages[-1].get("text", "") or "[Mídia]"
            last_from_me = messages[-1].get("from_me", False)
            try:
                conn_up = get_db()
                lead_row = conn_up.execute(
                    "SELECT id, last_msg, unread_count FROM leads WHERE thread_id = ? AND pipeline_id = ?",
                    (thread_id, current_user.pipeline_id)
                ).fetchone()
                if lead_row:
                    old_msg = lead_row['last_msg'] or ''
                    if old_msg != last_msg_text:
                        new_unread = lead_row['unread_count'] or 0
                        if not last_from_me:
                            new_unread += 1
                        conn_up.execute(
                            "UPDATE leads SET last_msg = ?, unread_count = ?, last_interaction = datetime('now') WHERE id = ?",
                            (last_msg_text, new_unread, lead_row['id'])
                        )
                        conn_up.commit()
                conn_up.close()
            except Exception as e:
                print(f"[IG MSG UPDATE] Erro ao atualizar lead: {e}")

        return jsonify({"success": True, "messages": messages})

    except (InstaLoginRequired, ClientJSONDecodeError, Exception) as e:
        print(f"[IG MESSAGES] Erro: {type(e).__name__}: {str(e)[:200]}")
        if _is_session_expired_error(e):
            _invalidate_instagram_session(current_user.id)
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401
        friendly = _parse_instagram_error(e)
        return jsonify({
            "success": False,
            "error": friendly or f"Erro ao buscar mensagens: {str(e)}"
        }), 500


@app.route('/api/instagram/send_message', methods=['POST'])
@login_required
def instagram_send_message():
    """Envia uma mensagem de texto em uma thread do Direct."""
    data = request.json
    thread_id = str(data.get('thread_id', ''))
    text = (data.get('text') or '').strip()

    if not thread_id or not text:
        return jsonify({"success": False, "error": "Thread ID e texto são obrigatórios."}), 400

    try:
        cl, _ = _get_instagram_client(current_user.id)
        if not cl:
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401

        _humanize_delay()
        cl.direct_send(text, thread_ids=[int(thread_id)])
        return jsonify({"success": True})

    except (InstaLoginRequired, ClientJSONDecodeError, Exception) as e:
        print(f"[IG SEND] Erro: {type(e).__name__}: {str(e)[:200]}")
        if _is_session_expired_error(e):
            _invalidate_instagram_session(current_user.id)
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401
        friendly = _parse_instagram_error(e)
        return jsonify({"success": False, "error": friendly or f"Erro ao enviar: {str(e)}"}), 500


# ==============================================================================
# RESPOSTAS RÁPIDAS (Quick Replies / Canned Responses)
# ==============================================================================

@app.route('/api/quick_replies', methods=['GET'])
@login_required
def get_quick_replies():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, title, content FROM quick_replies WHERE user_id = ? ORDER BY created_at DESC",
        (current_user.id,)
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "replies": [dict(r) for r in rows]})


@app.route('/api/quick_replies', methods=['POST'])
@login_required
def create_quick_reply():
    data = request.json
    title = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    if not title or not content:
        return jsonify({"success": False, "error": "Título e conteúdo são obrigatórios."}), 400
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO quick_replies (user_id, title, content) VALUES (?, ?, ?)",
        (current_user.id, title, content)
    )
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({"success": True, "id": new_id})


@app.route('/api/quick_replies/<int:reply_id>', methods=['DELETE'])
@login_required
def delete_quick_reply(reply_id):
    conn = get_db()
    conn.execute("DELETE FROM quick_replies WHERE id = ? AND user_id = ?", (reply_id, current_user.id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


# ==============================================================================
# ENVIO DE MÍDIA (Fotos/Vídeos/Áudio)
# ==============================================================================

@app.route('/api/instagram/send_media', methods=['POST'])
@login_required
def instagram_send_media():
    """Envia uma foto, vídeo ou áudio em uma thread do Direct."""
    thread_id = request.form.get('thread_id', '')
    media_type = request.form.get('media_type', 'photo')  # photo, video, audio
    file = request.files.get('file')

    if not thread_id or not file:
        return jsonify({"success": False, "error": "Thread ID e arquivo são obrigatórios."}), 400

    try:
        cl, _ = _get_instagram_client(current_user.id)
        if not cl:
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401

        _humanize_delay()
        import tempfile
        import subprocess

        suffix = os.path.splitext(file.filename)[1] if file.filename else '.jpg'
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        file.save(tmp.name)
        tmp.close()

        files_to_cleanup = [tmp.name]

        try:
            if media_type == 'photo':
                cl.direct_send_photo(tmp.name, thread_ids=[int(thread_id)])
            elif media_type == 'video':
                cl.direct_send_video(tmp.name, thread_ids=[int(thread_id)])
            else:
                # Áudio — Converter para .mp4 com video track (Instagram exige video container)
                try:
                    import imageio_ffmpeg
                    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
                except ImportError:
                    ffmpeg_bin = 'ffmpeg'

                mp4_path = tmp.name.rsplit('.', 1)[0] + '_voice.mp4'
                files_to_cleanup.append(mp4_path)

                try:
                    # Converter áudio para mp4 com video preto (1x1) para Instagram aceitar como vídeo
                    subprocess.run(
                        [
                            ffmpeg_bin,
                            '-f', 'lavfi', '-i', 'color=c=black:s=480x480:r=1',
                            '-i', tmp.name,
                            '-c:v', 'libx264', '-tune', 'stillimage',
                            '-c:a', 'aac', '-b:a', '128k',
                            '-shortest', '-pix_fmt', 'yuv420p',
                            '-y', mp4_path
                        ],
                        capture_output=True, timeout=60, check=True
                    )
                    print(f"[IG AUDIO] Convertido {suffix} -> .mp4 (video+audio)")
                    cl.direct_send_video(mp4_path, thread_ids=[int(thread_id)])
                    print(f"[IG AUDIO] Enviado com sucesso via direct_send_video")
                except subprocess.CalledProcessError as conv_err:
                    print(f"[IG AUDIO] ffmpeg falhou: {conv_err.stderr.decode() if conv_err.stderr else conv_err}")
                    # Fallback: tentar enviar como arquivo direto
                    cl.direct_send_file(tmp.name, thread_ids=[int(thread_id)])
                except FileNotFoundError:
                    print(f"[IG AUDIO] ffmpeg não encontrado, enviando como arquivo")
                    cl.direct_send_file(tmp.name, thread_ids=[int(thread_id)])

        finally:
            for f in files_to_cleanup:
                try:
                    os.unlink(f)
                except OSError:
                    pass

        return jsonify({"success": True})

    except (InstaLoginRequired, Exception) as e:
        print(f"[IG SEND MEDIA] Erro: {e}")
        if _is_session_expired_error(e):
            _invalidate_instagram_session(current_user.id)
            return jsonify({
                "success": False,
                "status": "reauthentication_required",
                "error": "Sessão expirada. Conecte o Instagram novamente."
            }), 401
        return jsonify({"success": False, "error": f"Erro ao enviar mídia: {str(e)}"}), 500


if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000, host='127.0.0.1')