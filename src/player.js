import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { createStream } from './ytdlp.js';

const IDLE_TIMEOUT_MS = 5 * 60_000;

export function formatDuration(seconds) {
  if (!seconds) return 'en vivo';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export class GuildPlayer {
  constructor(guild, onDestroy) {
    this.guild = guild;
    this.onDestroy = onDestroy;
    this.queue = [];
    this.current = null;
    this.source = null;
    this.connection = null;
    this.textChannel = null;
    this.idleTimer = null;
    this.destroyed = false;
    // 'off' | 'track' | 'queue'
    this.loop = 'off';
    this.shuffle = false;
    // Set for the current track so #next knows why it ended.
    this.skipped = false;
    this.failed = false;

    this.audio = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.audio.on(AudioPlayerStatus.Idle, () => this.#next());
    this.audio.on('error', (e) => {
      this.failed = true;
      this.#say(`No pude reproducir **${this.current?.title}** ;w; (${e.message})`);
    });
  }

  get channelId() {
    return this.connection?.joinConfig.channelId ?? null;
  }

  async connect(voiceChannel) {
    if (this.connection && this.channelId === voiceChannel.id) return;

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    if (connection !== this.connection) {
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        // A move between channels looks like a disconnect followed by a reconnect.
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          this.destroy();
        }
      });
      connection.subscribe(this.audio);
      this.connection = connection;
    }

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.destroy();
      throw new Error('No pude conectarme al canal de voz');
    }
  }

  enqueue(tracks, textChannel) {
    this.textChannel = textChannel ?? this.textChannel;
    this.queue.push(...tracks);
    if (!this.current) this.#next();
  }

  skip() {
    // Stopping triggers Idle, which starts the next track.
    this.skipped = true;
    return this.audio.stop(true);
  }

  stop() {
    this.queue = [];
    // Cleared first so loop mode doesn't put it back in the queue.
    this.current = null;
    this.audio.stop(true);
  }

  pause() {
    return this.audio.pause();
  }

  resume() {
    return this.audio.unpause();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.idleTimer);
    this.queue = [];
    this.current = null;
    this.source?.kill();
    this.source = null;
    this.audio.stop(true);
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    this.onDestroy(this);
  }

  #next() {
    if (this.destroyed) return;
    this.source?.kill();
    this.source = null;
    clearTimeout(this.idleTimer);

    const finished = this.current;
    const replay = finished && !this.failed;
    const repeatTrack = replay && this.loop === 'track' && !this.skipped;
    this.skipped = false;
    this.failed = false;

    if (repeatTrack) {
      this.current = finished;
    } else {
      const requeued = replay && this.loop === 'queue';
      if (requeued) this.queue.push(finished);
      // In shuffle mode, avoid replaying the track that just went back to the end.
      const pool = requeued && this.queue.length > 1 ? this.queue.length - 1 : this.queue.length;
      const index = this.shuffle ? Math.floor(Math.random() * pool) : 0;
      this.current = this.queue.splice(index, 1)[0] ?? null;
    }

    if (!this.current) {
      this.idleTimer = setTimeout(() => {
        this.#say('Me quedé solito sin música, me voy uwu');
        this.destroy();
      }, IDLE_TIMEOUT_MS);
      return;
    }

    const track = this.current;
    this.source = createStream(track.url, (e) => {
      if (this.current !== track) return;
      this.failed = true;
      this.#say(`No pude reproducir **${track.title}** ;w; (${e.message})`);
    });
    this.audio.play(createAudioResource(this.source.stream, { inputType: StreamType.OggOpus }));
    if (!repeatTrack) this.#say(`🎶 Sonando: **${track.title}** \`${formatDuration(track.duration)}\``);
  }

  #say(content) {
    this.textChannel?.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
  }
}
