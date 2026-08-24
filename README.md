# Private Stream

Aplicação de salas privadas para transmissão de tela em tempo real usando WebRTC e Socket.IO.

## Tecnologias

- Node.js, Express
- Socket.IO
- WebRTC (getDisplayMedia)
- HTML5, CSS3, Vanilla JS

## Instalação

```bash
npm install
```

## Execução local

```bash
npm start
```

Acesse `http://localhost:3000`.

## Deploy no Render

- Crie um novo Web Service no Render apontando para o repositório.
- Configure `npm start` como comando de start.
- Render definirá `PORT` automaticamente.

### Notas importantes para produção

- WebRTC usa ICE (STUN/TURN) para atravessar NATs/firewalls. Este projeto inclui um STUN público (`stun:stun.l.google.com:19302`) por padrão para melhorar a descoberta ICE, mas **não** garante conectividade em redes restritas.
- Recomenda-se configurar um servidor TURN em produção (ex.: coturn) e fornecer suas credenciais via `window.RTC_CONFIG` ou injetar no frontend pelo servidor.

Exemplo de `window.RTC_CONFIG` (injetar no HTML via template/server):

```html
<script>
	window.RTC_CONFIG = { iceServers: [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
	] };
</script>
```

### Passos de deploy no Render (resumido)

1. Commit & push para o seu repositório Git.
2. No Render: New → Web Service → selecione o repositório.
3. Build command: (opcional) `npm install` — Render executa automaticamente `install` na maioria dos casos.
4. Start command: `npm start`.
5. Adicione variáveis de ambiente no painel do Render, se necessário (ex.: credenciais TURN, variáveis customizadas).
6. Após o deploy, abra a URL HTTPS fornecida e teste criando/entrando em salas.

### Logs e troubleshooting

- Verifique os logs no painel do Render para mensagens do servidor (`Server running on port ...`) e erros.
- Se WebRTC não conectar entre pares, verifique as mensagens ICE no console do navegador e considere adicionar TURN.

## Observações

- Salas são mantidas em memória (Map). Reiniciar o servidor limpa salas.
- Atualmente apenas compartilhamento de tela está implementado.
- STUN/TURN podem ser adicionados futuro.
