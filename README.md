# Conserje · fase 0

Revisa tus canales de YouTube, detecta cuándo aparecen tus programas y personas favoritas, te avisa
(consola o Telegram) y arma una página de novedades. Sin dependencias: solo Node 18 o superior.

## Probarlo en 1 minuto (sin claves)
    node test.js            # 10 pruebas de la lógica
    node conserje.js --mock # simula videos de tus favoritos, imprime los avisos y crea site/index.html

## Usarlo con YouTube de verdad
1. **Clave de YouTube** (gratis): en console.cloud.google.com crea un proyecto, activa "YouTube Data API v3"
   y crea una clave de API. Cada corrida usa pocas unidades de las 10.000 diarias.
2. Copia `.env.example` a `.env` y pega la clave en `YOUTUBE_API_KEY=`.
3. `node conserje.js`. **La primera corrida es silenciosa**: guarda lo que ya existe para no avisarte del pasado.
4. Abre `site/index.html` en el navegador.
5. Para que corra solo, programa una tarea cada 15 minutos (en Linux/Mac: `crontab -e` y
   `*/15 * * * * cd /ruta/a/conserje && node conserje.js`).

## Avisos por Telegram (puente hasta tener WhatsApp)
Crea un bot con @BotFather, copia el token a `TELEGRAM_BOT_TOKEN`, escríbele un mensaje al bot y obtén tu
`TELEGRAM_CHAT_ID` desde `https://api.telegram.org/bot<TOKEN>/getUpdates`. Si ambas claves existen, los avisos
salen por Telegram; si no, se imprimen en pantalla.

## En la nube, gratis y sin instalar nada (GitHub)
El archivo `.github/workflows/conserje.yml` ejecuta el programa cada 15 minutos, guarda su memoria
(`state.json`) y publica la página con GitHub Pages. Requiere un repositorio **público** (el plan gratuito de
GitHub Pages lo exige) y tres "secrets" en Settings > Secrets and variables > Actions:
`YOUTUBE_API_KEY`, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`. En Settings > Pages, la fuente debe ser "GitHub Actions".

## Personalizar (config.json)
- `channels`: canales a vigilar (`@handle`). `recent` = cuántos videos recientes revisar.
- `programs`: un programa = canal + filtro opcional `match` (texto en título o descripción).
  Reglas: `onPublish` (avisar al publicarse), `leadMinutes` (avisos antes de un directo, ej. `[300, 60]`),
  `digestOnly` (solo en el resumen).
- `persons`: nombre + `aliases`. Nombre en el título = aparición (usa sus reglas);
  solo en la descripción = mención (va al resumen).
- `digest`: resumen diario (hora local). `quietHours`: no avisa en ese horario y espera. `dailyCap`: tope diario.

## Qué no se pudo verificar todavía
Las pruebas usan datos simulados: desde el entorno donde se armó no había acceso a YouTube. En la primera
corrida real conviene revisar: (1) que los `@handle` se resuelvan, (2) que los directos programados aparezcan
con su hora, (3) que el filtro `"sin manual"` capture los episodios correctos.

## Siguientes pasos
WhatsApp (API oficial de Meta, con plantillas), preferencias por usuario, base de datos y cuentas.
