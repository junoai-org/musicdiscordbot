# musicdiscordbot

Bot de música para Discord owo. Usa [yt-dlp](https://github.com/yt-dlp/yt-dlp) para buscar y descargar el audio, ffmpeg para convertirlo a Opus y [discord.js](https://discord.js.org) para enviarlo al canal de voz.

## Requisitos

- Node.js 22 o superior
- `yt-dlp` y `ffmpeg` en el `PATH`

```bash
# macOS
brew install yt-dlp ffmpeg
```

## Instalación

```bash
git clone https://github.com/junoai-org/musicdiscordbot.git
cd musicdiscordbot
npm install
cp .env.example .env
```

1. Crea una aplicación en el [portal de desarrolladores de Discord](https://discord.com/developers/applications), ve a **Bot** y copia el token en `DISCORD_TOKEN` dentro de `.env`.
2. En la misma página, en **Privileged Gateway Intents**, activa **Message Content Intent** (hace falta para los comandos con prefijo).
3. En **OAuth2 → URL Generator** marca los scopes `bot` y `applications.commands`, con los permisos **View Channels**, **Send Messages**, **Connect** y **Speak**. Abre la URL generada para invitar al bot.
4. Arráncalo:

```bash
npm start
```

## Configuración

| Variable | Descripción |
|---|---|
| `DISCORD_TOKEN` | Token del bot (obligatorio) |
| `GUILD_ID` | ID de un servidor; si se define, los comandos `/` se registran ahí y aparecen al instante |
| `PREFIX` | Prefijo de los comandos por mensaje (por defecto `!`) |
| `YTDLP_PATH`, `FFMPEG_PATH` | Rutas a los binarios si no están en el `PATH` |

## Comandos

Todos funcionan como comando de barra (`/play`) y con prefijo (`!play`).

| Comando | Atajo | Qué hace |
|---|---|---|
| `play <canción o URL>` | `!p` | Reproduce un video o playlist, o busca el texto en YouTube |
| `skip` | `!s` | Salta la canción actual |
| `pause` | | Pausa la música |
| `resume` | `!r` | Reanuda la música |
| `queue` | `!q` | Muestra la cola |
| `nowplaying` | `!np` | Muestra qué está sonando |
| `loop [off\|cancion\|cola]` | `!repeat` | Repite la canción o toda la cola; sin opción, cambia al siguiente modo |
| `shuffle` | `!random` | Activa o desactiva el modo aleatorio |
| `stop` | | Detiene la música y vacía la cola |
| `leave` | `!l` | Saca al bot del canal de voz |

Cada vez que empieza una canción, el bot manda un mensaje con botones de reproductor: ⏸️ pausa/reanuda, ⏭️ salta, ⏹️ detiene, 🔁 cambia el loop, 🔀 activa el aleatorio y 📜 muestra la cola (solo a quien lo pulsa). Los botones solo aparecen en el mensaje de la canción actual y desaparecen del anterior cuando cambia.

El bot se desconecta solo si se queda sin gente en el canal o tras 5 minutos sin música.

Si YouTube deja de funcionar, actualiza yt-dlp (`brew upgrade yt-dlp` o `yt-dlp -U`).

## Licencia

[AGPL v3](LICENSE). Si hospedas una versión modificada de este bot, tienes que ofrecer su código fuente a quienes lo usan.
