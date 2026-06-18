# Plataforma de Entregas — mapa ao vivo (Cenário 3)

Site que mostra os entregadores, restaurantes e clientes num mapa real de
Gravataí/RS, lendo os dados direto do **MongoDB Atlas**. Ao clicar num
restaurante, ele consulta o banco (`$geoNear`) e destaca os entregadores
disponíveis dentro do raio escolhido.

## Arquitetura (3 camadas)

```
Navegador (Leaflet)  →  Backend (Node/Express)  →  MongoDB Atlas
   mapa + cliques        guarda a senha,             os dados
                         faz as consultas geo
```

O navegador **nunca** fala direto com o banco — quem tem a senha é só o servidor.

## Como rodar (uma vez)

1. Garanta que o banco já tem dados: rode o `../pratica_mongodb/01_seed.mongodb.js`
   no Compass (cria as coleções, insere e cria o índice 2dsphere).
2. Dentro desta pasta, crie um arquivo **`.env`** (copie de `.env.example`) e
   cole sua connection string do Atlas:
   ```
   MONGODB_URI=mongodb+srv://usuario:senha@trabalhobdnc.07rbidg.mongodb.net/
   PORT=3000
   ```
   ⚠️ Use a senha real, sem `< >`. Evite caracteres especiais na senha.
3. Instale as dependências (já feito uma vez):
   ```
   npm install
   ```
4. Suba o servidor:
   ```
   npm start
   ```
5. Abra no navegador: **http://localhost:3000**

## Endpoints da API (o que o backend expõe)

| Rota | O que faz |
|------|-----------|
| `GET /api/pontos` | Devolve todos os entregadores, restaurantes e clientes |
| `GET /api/proximos?lng=..&lat=..&raio=..` | Entregadores disponíveis dentro do raio (em metros), com a distância calculada |

## Erros comuns

| Erro no terminal | Solução |
|------------------|---------|
| `Falta a variavel MONGODB_URI` | Você não criou o `.env` (passo 2). |
| `Nao conectou no Atlas` | Network Access sem `0.0.0.0/0`, ou usuário/senha errados. |
| Mapa abre mas sem pontos | O banco está vazio — rode o `01_seed` primeiro. |
| `unable to find index for $geoNear` | Faltou o índice 2dsphere — está no `01_seed`. |
