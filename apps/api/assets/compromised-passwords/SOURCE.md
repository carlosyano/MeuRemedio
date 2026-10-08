# Lista local de senhas comprometidas (DEC-029)

| Campo | Valor |
|---|---|
| Fonte | SecLists (Daniel Miessler e colaboradores), licença MIT (`LICENSE-SecLists`) |
| Arquivo | `Passwords/Common-Credentials/10-million-password-list-top-100000.txt` |
| Commit fixado | `2d5dc7504a40962c53f932a6d9d5ece4b213dfc6` (último em que o arquivo existe) |
| URL | https://raw.githubusercontent.com/danielmiessler/SecLists/2d5dc7504a40962c53f932a6d9d5ece4b213dfc6/Passwords/Common-Credentials/10-million-password-list-top-100000.txt |
| SHA-256 | `e30e15faecc8db2d3181c3126e3b2c0cd5c187af10a5e4e83babfa157edab188` |
| Entradas | 100.007 linhas (UTF-8, LF) |
| Obtido em | 08/10/2026 |

O arquivo foi removido do SecLists no commit `4ff3ff8` (08/05/2025) por duplicar `xato-net-10-million-passwords-100000.txt`, que hoje tem 7 linhas a menos. A DEC-029 cita o caminho exato, por isso a versão fixada é a do commit anterior à remoção (DC-014). A aplicação confere o SHA-256 ao carregar a lista e não sobe se ele divergir. Atualizar a lista exige PR próprio, com novo commit, hash e registro aqui.
