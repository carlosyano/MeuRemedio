// Cliente da API no navegador: mesma origem, cookies da sessao (DC-052).
import { createApiClient } from './api-client';

export const api = createApiClient({
  fetch: (input, init) => fetch(input, init),
  readCookies: () => document.cookie,
});
