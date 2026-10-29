# Ferramentas de bastidor

Código que não é servido como página, versionado aqui para ficar
registrado junto com o site.

## apps-script-leads.gs

Recebedor da planilha de leads. Vive no Apps Script vinculado à
planilha "Leads — Site Mkteúdo", não neste repositório — a cópia
aqui é a fonte da verdade para consulta e para restaurar se alguém
mexer no editor por engano.

Quando mudar um campo do formulário do site, ajuste a lista `COLS`
e rode `configurar()` uma vez.
