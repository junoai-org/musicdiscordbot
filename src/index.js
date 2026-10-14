import { Client, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { GuildPlayer, LOOP_MODES, formatDuration } from './player.js';
import { resolve } from './ytdlp.js';

const { DISCORD_TOKEN, GUILD_ID } = process.env;
const PREFIX = process.env.PREFIX || '!';
if (!DISCORD_TOKEN) {
  console.error('Falta DISCORD_TOKEN. Copia .env.example a .env y pon el token de tu bot.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Reproduce una canción o playlist (URL o búsqueda)')
    .addStringOption((o) => o.setName('cancion').setDescription('URL o lo que quieras buscar').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Salta la canción actual'),
  new SlashCommandBuilder().setName('pause').setDescription('Pausa la música'),
  new SlashCommandBuilder().setName('resume').setDescription('Reanuda la música'),
  new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Muestra qué está sonando'),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Repite la canción o la cola (sin opción, cambia al siguiente modo)')
    .addStringOption((o) =>
      o
        .setName('modo')
        .setDescription('Qué repetir')
        .addChoices(
          { name: 'Desactivado', value: 'off' },
          { name: 'Canción', value: 'track' },
          { name: 'Cola', value: 'queue' },
        ),
    ),
  new SlashCommandBuilder().setName('shuffle').setDescription('Activa o desactiva el modo aleatorio'),
  new SlashCommandBuilder().setName('stop').setDescription('Detiene la música y vacía la cola'),
  new SlashCommandBuilder().setName('leave').setDescription('Saca al bot del canal de voz'),
].map((c) => c.setDMPermission(false).toJSON());

// Short forms for prefix commands, e.g. !p instead of !play.
const aliases = {
  p: 'play',
  s: 'skip',
  q: 'queue',
  np: 'nowplaying',
  r: 'resume',
  l: 'leave',
  repeat: 'loop',
  random: 'shuffle',
  aleatorio: 'shuffle',
};

const loopLabels = { off: 'desactivado', track: '🔂 canción', queue: '🔁 cola' };
const loopWords = {
  off: 'off', no: 'off', desactivado: 'off',
  track: 'track', song: 'track', cancion: 'track', uno: 'track',
  queue: 'queue', cola: 'queue', todo: 'queue', all: 'queue',
};

function modesLine(player) {
  const modes = [];
  if (player.loop !== 'off') modes.push(`loop: ${loopLabels[player.loop]}`);
  if (player.shuffle) modes.push('🔀 aleatorio');
  return modes.length ? `*${modes.join(' · ')}*\n` : '';
}

function nextLoopMode(player) {
  return LOOP_MODES[(LOOP_MODES.indexOf(player.loop) + 1) % LOOP_MODES.length];
}

function queueText(player) {
  const lines = [`${modesLine(player)}🎶 **${player.current.title}** \`${formatDuration(player.current.duration)}\``];
  player.queue.slice(0, 10).forEach((t, i) => lines.push(`${i + 1}. ${t.title} \`${formatDuration(t.duration)}\``));
  if (player.queue.length > 10) lines.push(`…y ${player.queue.length - 10} más`);
  if (!player.queue.length) lines.push('*La cola está vacía*');
  return lines.join('\n');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const players = new Map();

function getPlayer(guild) {
  let player = players.get(guild.id);
  if (!player) {
    player = new GuildPlayer(guild, (p) => {
      if (players.get(p.guild.id) === p) players.delete(p.guild.id);
    });
    players.set(guild.id, player);
  }
  return player;
}

// Slash commands and prefix messages are wrapped in the same shape so handlers serve both.
function fromInteraction(interaction) {
  return {
    guild: interaction.guild,
    member: interaction.member,
    channel: interaction.channel,
    arg: interaction.options.getString('cancion') ?? interaction.options.getString('modo'),
    defer: () => interaction.deferReply(),
    reply(content, { ephemeral = false } = {}) {
      const payload = { content, allowedMentions: { parse: [] } };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
    },
  };
}

function fromMessage(message, arg) {
  return {
    guild: message.guild,
    member: message.member,
    channel: message.channel,
    arg,
    defer: () => message.channel.sendTyping().catch(() => {}),
    reply: (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }),
  };
}

const handlers = {
  async play(ctx, voiceChannel) {
    if (!ctx.arg) return ctx.reply(`Dime qué quieres escuchar, p. ej. \`${PREFIX}play lofi\` >w<`);

    const existing = players.get(ctx.guild.id);
    if (existing?.current && existing.channelId !== voiceChannel.id) {
      return ctx.reply('Ya estoy sonando en otro canal >w<', { ephemeral: true });
    }

    await ctx.defer();
    const tracks = await resolve(ctx.arg);
    if (!tracks.length) return ctx.reply('No encontré nada ;w;');

    const player = getPlayer(ctx.guild);
    await player.connect(voiceChannel);
    player.enqueue(tracks, ctx.channel);

    await ctx.reply(
      tracks.length === 1
        ? `Añadida a la cola: **${tracks[0].title}** \`${formatDuration(tracks[0].duration)}\` owo`
        : `Añadidas **${tracks.length}** canciones a la cola owo`,
    );
  },

  skip(ctx, _voiceChannel, player) {
    const title = player.current.title;
    player.skip();
    return ctx.reply(`⏭️ Saltada: **${title}**`);
  },

  pause(ctx, _voiceChannel, player) {
    return ctx.reply(player.pause() ? '⏸️ Pausado' : 'No hay nada que pausar');
  },

  resume(ctx, _voiceChannel, player) {
    return ctx.reply(player.resume() ? '▶️ Seguimos uwu' : 'No estaba en pausa');
  },

  queue(ctx, _voiceChannel, player) {
    return ctx.reply(queueText(player));
  },

  loop(ctx, _voiceChannel, player) {
    let mode;
    if (!ctx.arg) {
      mode = nextLoopMode(player);
    } else {
      const word = ctx.arg.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      mode = Object.hasOwn(loopWords, word) ? loopWords[word] : null;
      if (!mode) return ctx.reply(`Usa \`${PREFIX}loop cancion\`, \`${PREFIX}loop cola\` o \`${PREFIX}loop off\``);
    }
    player.setLoop(mode);
    return ctx.reply(`Loop: ${loopLabels[mode]}`);
  },

  shuffle(ctx, _voiceChannel, player) {
    player.setShuffle(!player.shuffle);
    return ctx.reply(player.shuffle ? '🔀 Modo aleatorio activado owo' : 'Modo aleatorio desactivado');
  },

  nowplaying(ctx, _voiceChannel, player) {
    const { title, url, duration } = player.current;
    return ctx.reply(`${modesLine(player)}🎶 **${title}** \`${formatDuration(duration)}\`\n<${url}>`);
  },

  stop(ctx, _voiceChannel, player) {
    player.stop();
    return ctx.reply('⏹️ Detenido y cola vacía');
  },

  leave(ctx, _voiceChannel, player) {
    player.destroy();
    return ctx.reply('Bai bai owo 👋');
  },
};

async function run(name, ctx) {
  try {
    const voiceChannel = ctx.member?.voice.channel;
    if (!voiceChannel) return await ctx.reply('Entra a un canal de voz primero >w<', { ephemeral: true });

    const player = players.get(ctx.guild.id);
    if (name !== 'play') {
      if (!player?.current) return await ctx.reply('No hay nada sonando', { ephemeral: true });
      if (player.channelId !== voiceChannel.id) {
        return await ctx.reply('Tienes que estar en mi canal de voz', { ephemeral: true });
      }
    }

    await handlers[name](ctx, voiceChannel, player);
  } catch (e) {
    console.error(e);
    await ctx.reply(`Algo salió mal ;w; (${e.message})`.slice(0, 1900), { ephemeral: true }).catch(() => {});
  }
}

// Buttons on the "now playing" message. The player edits the message itself to reflect the new state.
async function onButton(interaction) {
  const action = interaction.customId.slice('music:'.length);
  const player = players.get(interaction.guildId);
  const whisper = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  try {
    // Leftover buttons, e.g. from before a restart.
    if (!player?.current || player.panel?.id !== interaction.message.id) {
      return await interaction.update({ components: [] });
    }
    if (interaction.member.voice.channelId !== player.channelId) {
      return await whisper('Tienes que estar en mi canal de voz');
    }
    if (action === 'queue') return await whisper(queueText(player));

    await interaction.deferUpdate();
    switch (action) {
      case 'toggle':
        if (player.paused) player.resume();
        else player.pause();
        break;
      case 'skip':
        player.skip();
        break;
      case 'stop':
        player.stop();
        break;
      case 'loop':
        player.setLoop(nextLoopMode(player));
        break;
      case 'shuffle':
        player.setShuffle(!player.shuffle);
        break;
    }
  } catch (e) {
    console.error(e);
  }
}

client.once(Events.ClientReady, async (c) => {
  // Guild commands appear instantly; global ones can take a while to propagate.
  if (GUILD_ID) await c.application.commands.set(commands, GUILD_ID);
  else await c.application.commands.set(commands);
  console.log(`Conectado como ${c.user.tag} owo (prefijo: ${PREFIX})`);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.inCachedGuild()) return;
  if (interaction.isButton() && interaction.customId.startsWith('music:')) return onButton(interaction);
  if (!interaction.isChatInputCommand()) return;
  if (!Object.hasOwn(handlers, interaction.commandName)) return;
  return run(interaction.commandName, fromInteraction(interaction));
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || !message.inGuild() || !message.content.startsWith(PREFIX)) return;
  const [word = '', ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const name = aliases[word.toLowerCase()] ?? word.toLowerCase();
  // Unknown words are ignored: other bots may share the same prefix.
  if (!Object.hasOwn(handlers, name)) return;
  return run(name, fromMessage(message, rest.join(' ')));
});

// Leave when everyone else has left the voice channel.
client.on(Events.VoiceStateUpdate, (oldState) => {
  const player = players.get(oldState.guild.id);
  if (!player?.channelId || oldState.channelId !== player.channelId) return;
  const channel = oldState.guild.channels.cache.get(player.channelId);
  if (channel && channel.members.every((m) => m.user.bot)) player.destroy();
});

client.login(DISCORD_TOKEN).catch((e) => {
  if (/disallowed intents/i.test(e.message)) {
    console.error(
      'Discord rechazó la conexión: activa "Message Content Intent" en\n' +
        'https://discord.com/developers/applications → tu app → Bot → Privileged Gateway Intents.',
    );
  } else {
    console.error(e);
  }
  process.exit(1);
});
