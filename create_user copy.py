import sqlite3
from werkzeug.security import generate_password_hash

DB_NAME = "local_crm.db"

def create_admin():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Criar tabela users previnindo erro se não existir
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            meta_token TEXT,
            ig_page_id TEXT,
            pipeline_id INTEGER DEFAULT 1,
            role TEXT DEFAULT 'admin',
            FOREIGN KEY(pipeline_id) REFERENCES pipelines(id)
        )
    ''')
    
    # Inserir ou atualizar admin
    username = "admin"
    password = generate_password_hash("admin")
    
    # Verifica
    exist = cursor.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if exist:
        cursor.execute("UPDATE users SET password = ?, role = 'admin' WHERE username = ?", (password, username))
        print("Senha do admin atualizada para 'admin'")
    else:
        cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')", (username, password))
        print("Usuário 'admin' criado com a senha 'admin'")
        
    conn.commit()
    conn.close()

if __name__ == '__main__':
    create_admin()
