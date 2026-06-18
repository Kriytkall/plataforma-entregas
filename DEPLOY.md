# Como colocar a plataforma online (deploy no Render — grátis)

Objetivo: ter um link público (ex.: `https://entregas-grupo03.onrender.com`)
que os 3 integrantes acessam, e que mostra os dados do Atlas ao vivo.

## Por que precisa de hospedagem (e não é só "publicar o HTML")
A plataforma tem um **backend** (server.js) que conversa com o Atlas. Então não
dá pra hospedar só o HTML — precisamos de um lugar que **rode Node.js**. O Render
faz isso de graça.

---

## Passo 1 — Subir o código para o GitHub

1. Crie uma conta em https://github.com (se não tiver).
2. Crie um repositório novo (ex.: `plataforma-entregas`), pode ser **público**.
   - ⚠️ O `.gitignore` já garante que o `.env` (com a senha) **NÃO** vai subir.
3. Na pasta `plataforma`, rode no terminal:
   ```
   git init
   git add .
   git commit -m "Plataforma de entregas - Cenario 3"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/plataforma-entregas.git
   git push -u origin main
   ```

## Passo 2 — Criar o serviço no Render

1. Crie conta em https://render.com (dá pra entrar com o GitHub).
2. **New + → Web Service** → conecte seu GitHub → escolha o repositório.
3. Configurações:
   - **Root Directory:** `plataforma`  (se o repo for só a pasta plataforma, deixe vazio)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
4. Em **Environment Variables**, adicione:
   - Key: `MONGODB_URI`
   - Value: `mongodb+srv://grupo03bdnc:SENHA@trabalhobdnc.07rbidg.mongodb.net/`
   - (O Render define a `PORT` sozinho — não precisa criar.)
5. **Create Web Service**. O Render instala e sobe. Em ~2 min aparece o link público.

## Passo 3 — Liberar o Render no Atlas

- O Atlas já está com **Network Access = 0.0.0.0/0** (acesso de qualquer lugar),
  então o Render consegue conectar. Se mudarem isso, o site para de funcionar.

---

## Pronto
- O link funciona pra qualquer um dos 3 (e pro professor).
- Editou o banco no Compass → marque "Atualizar ao vivo" no site (ou F5) →
  a mudança aparece pra todo mundo que estiver com o link aberto.

## Avisos importantes
- **Plano free "dorme":** depois de ~15 min sem acesso, o serviço hiberna. O
  primeiro acesso seguinte demora ~30-50s pra "acordar". Normal no plano grátis.
- **Segurança:** o site só tem rotas de LEITURA (`/api/pontos`, `/api/proximos`).
  Ninguém consegue alterar o banco pelo site — só visualizar. As alterações são
  feitas por vocês no Compass/Atlas.
- Depois de entregar o trabalho, troquem a senha do banco no Atlas (Database Access).
