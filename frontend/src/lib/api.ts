export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
    const url = `${API_URL}${endpoint}`;

    const isFormData = options.body instanceof FormData;
    const defaultOptions: RequestInit = {
        ...options,
        headers: {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            ...options.headers,
        },
        credentials: 'include',
    };

    const response = await fetch(url, defaultOptions);

    // 401 = sessão do CRM expirou → redirecionar para login
    // MAS: rotas do Instagram retornam 401 quando a sessão do IG expira (não do CRM)
    const isInstagramRoute = endpoint.startsWith('/instagram') || endpoint.includes('sync_messages');
    if (response.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/me' && !isInstagramRoute) {
        if (typeof window !== 'undefined') {
            window.location.href = '/';
        }
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }

    return response.text();
}
