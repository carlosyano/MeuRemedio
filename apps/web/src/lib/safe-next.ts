// Destino depois de entrar (TS-019): so caminhos internos da aplicacao, nunca outra origem
// (evita redirecionamento aberto).
const hasControlCharacter = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

export function safeNext(value: string | undefined, fallback = '/hoje'): string {
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || hasControlCharacter(value)) return fallback;
  return value;
}
