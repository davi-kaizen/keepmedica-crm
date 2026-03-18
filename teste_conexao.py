import requests
import json

# SEU TOKEN (O mesmo que você já gerou)
TOKEN = "EAAMtZA5foFycBQzioZCXdy8syZBYv99rd0FRycpAHxyZCpDVAwADTxgCBfaXAGvqUeJDwYkzchRPTllJux1CROnZBQOf9pTLA5POAIzfohDpYsIFqXyJOVAAIqjuM2MAB8sSsS22seTVpCB3U5WZB4WnrFFTez6UMkDlzEZCqvs3d5zk3kpNpsxgcdLyFGnJZC91mlvBqteixiqWd0ZAEXEXEu85tCMHWD2uYXJ1SsXmBqDsZD"

GRAPH_URL = "https://graph.facebook.com/v18.0"

def diagnostico():
    print("\n" + "="*40)
    print("🕵️  DIAGNÓSTICO DE CONEXÃO KEEPMED")
    print("="*40 + "\n")
    
    # ---------------------------------------------------------
    # ETAPA 1: IDENTIFICAR O TOKEN
    # ---------------------------------------------------------
    print("1️⃣  Verificando Token...")
    # Não pedimos mais 'accounts' aqui para evitar o erro #100 se for Página
    params_me = {'access_token': TOKEN, 'fields': 'id,name,instagram_business_account'}
    resp_me = requests.get(f"{GRAPH_URL}/me", params=params_me)
    data_me = resp_me.json()
    
    if 'error' in data_me:
        print("❌ ERRO NO TOKEN:")
        print(f"   Mensagem: {data_me['error']['message']}")
        return

    user_name = data_me.get('name', 'Desconhecido')
    user_id = data_me.get('id')
    print(f"   ✅ Token Válido! Identidade: {user_name} (ID: {user_id})")
    
    ig_id = None
    
    # ---------------------------------------------------------
    # ETAPA 2: BUSCAR INSTAGRAM
    # ---------------------------------------------------------
    print("\n2️⃣  Buscando vínculo com Instagram...")

    # Cenário A: Token de Página (Vínculo direto)
    if 'instagram_business_account' in data_me:
        ig_id = data_me['instagram_business_account']['id']
        print(f"   🎉 VÍNCULO DIRETO ENCONTRADO (Token de Página)!")
        print(f"   📸 Instagram ID: {ig_id}")

    # Cenário B: Token de Usuário (Vínculo via accounts)
    else:
        print("   ℹ️  Vínculo direto não encontrado. Verificando contas vinculadas...")
        try:
            resp_acc = requests.get(f"{GRAPH_URL}/me/accounts", params={'access_token': TOKEN})
            data_acc = resp_acc.json()
            if 'data' in data_acc:
                for page in data_acc['data']:
                    p_resp = requests.get(
                        f"{GRAPH_URL}/{page['id']}", 
                        params={'fields': 'instagram_business_account', 'access_token': TOKEN}
                    )
                    p_data = p_resp.json()
                    if 'instagram_business_account' in p_data:
                        ig_id = p_data['instagram_business_account']['id']
                        print(f"   🎉 ENCONTRADO NA PÁGINA '{page['name']}'! Instagram ID: {ig_id}")
                        break
        except:
            pass

    if not ig_id:
        print("❌ ERRO CRÍTICO: Nenhuma conta Instagram Business encontrada.")
        print("   -> Verifique se a página do Facebook está conectada ao Instagram.")
        return

    # ---------------------------------------------------------
    # ETAPA 3: TESTE DE MENSAGENS
    # ---------------------------------------------------------
    print(f"\n3️⃣  Testando Leitura de Mensagens no ID {ig_id}...")
    
    url_conv = f"{GRAPH_URL}/{ig_id}/conversations"
    params_conv = {
        'access_token': TOKEN, 
        'limit': 5
        # Note: Removi 'platform' para testar a conexão crua
    }
    
    resp_conv = requests.get(url_conv, params=params_conv)
    data_conv = resp_conv.json()
    
    if 'error' in data_conv:
        err_msg = data_conv['error'].get('message')
        print(f"❌ FALHA NA API: {err_msg}")
        
        if "(#3)" in err_msg or "capability" in err_msg:
            print("\n🚨 DIAGNÓSTICO FINAL: ERRO #3")
            print("O token está ok, mas o APLICATIVO no Facebook não tem permissão.")
            print("SOLUÇÃO:")
            print("1. Vá em developers.facebook.com > Seu App > Messenger > Configurações do Instagram.")
            print("2. Clique no botão azul 'Adicionar ou Remover Páginas'.")
            print("3. Selecione 'PachoKeep'. Isso é obrigatório!")
    else:
        lista = data_conv.get('data', [])
        print("✅ SUCESSO TOTAL! O SISTEMA CONSEGUE LER MENSAGENS!")
        print(f"   📬 Conversas encontradas: {len(lista)}")
        
        if len(lista) == 0:
            print("   ⚠️  A lista está vazia. O sistema funciona, mas não há conversas recentes.")
            print("   -> DICA: Envie um 'Oi' de outra conta agora para testar.")

if __name__ == "__main__":
    diagnostico()
    input("\nPressione ENTER para sair...")