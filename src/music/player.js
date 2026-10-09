import ffmpegPath from 'ffmpeg-static';
import { GuildQueueEvent, Player } from 'discord-player';
import { YoutubeExtractor } from 'discord-player-youtubei';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

let playerInstance = null;

export async function initializePlayer(client) {
  if (playerInstance) {
    return playerInstance;
  }

  if (!ffmpegPath) {
    logger.error('[Music] FFmpeg not found');
    throw new Error('FFmpeg binary could not be located.');
  }

  logger.info('[Music] FFmpeg found');
  logger.info('[Music] Initializing Discord Player...');

  playerInstance = new Player(client);

  const musicDebug = process.env.MUSIC_DEBUG?.trim().toLowerCase() === 'true';
  if (musicDebug) {
    playerInstance.on('debug', (message) => {
      logger.info(`[Music] Debug: ${message}`);
    });
  }

  playerInstance.on('error', (error) => {
    logMusicError('Player error', error);
  });

  playerInstance.events.on(GuildQueueEvent.PlayerStart, (_queue, track) => {
    if (!isMusicDebugEnabled()) {
      return;
    }
    const title = track?.title ?? track?.cleanTitle ?? 'unknown track';
    logger.info(`[Music Event] PlayerStart: ${title}`);
    logger.info(`[Music Queue] Current: ${_queue.currentTrack?.title ?? 'none'}`);
    const upcoming = _queue.tracks.toArray().map((queuedTrack) => queuedTrack.title);
    logger.info(`[Music Queue] Upcoming count: ${upcoming.length}`);
    logger.info(`[Music Queue] Upcoming: ${upcoming.join(' | ') || 'none'}`);
  });

  playerInstance.events.on(GuildQueueEvent.PlayerFinish, (queue, track) => {
    const title = track?.title ?? track?.cleanTitle ?? 'unknown track';
    if (isMusicDebugEnabled()) {
      logger.info(`[Music Event] PlayerFinish: ${title}`);
      logger.info(`[Music Queue] Current after finish: ${queue.currentTrack?.title ?? 'none'}`);
      const upcoming = queue.tracks.toArray().map((queuedTrack) => queuedTrack.title);
      logger.info(`[Music Queue] Upcoming after finish: ${upcoming.length} [${upcoming.join(' | ') || 'none'}]`);
    }
  });

  playerInstance.events.on(GuildQueueEvent.PlayerSkip, (_queue, track) => {
    if (!isMusicDebugEnabled()) {
      return;
    }
    const title = track?.title ?? track?.cleanTitle ?? 'unknown track';
    logger.info(`[Music Event] PlayerSkip: ${title}`);
  });

  playerInstance.events.on(GuildQueueEvent.EmptyQueue, (queue) => {
    if (!isMusicDebugEnabled()) {
      return;
    }
    const current = queue.currentTrack?.title ?? 'none';
    const upcoming = queue.tracks.toArray().map((track) => track.title);
    logger.info('[Music Event] EmptyQueue');
    logger.info(`[Music Queue] Current: ${current}`);
    logger.info(`[Music Queue] Upcoming count: ${upcoming.length}`);
    logger.info(`[Music Queue] Upcoming: ${upcoming.join(' | ') || 'none'}`);
  });

  playerInstance.events.on(GuildQueueEvent.QueueDelete, (queue) => {
    if (isMusicDebugEnabled()) {
      logger.warn(`[Music Queue] QueueDelete emitted for guild ${queue.guild.id}`);
    }
  });

  playerInstance.events.on(GuildQueueEvent.PlayerError, (_queue, error, track) => {
    const title = track?.title ?? track?.cleanTitle ?? 'unknown track';
    logMusicError(`PlayerError while playing ${title}`, error);
  });

  playerInstance.events.on(GuildQueueEvent.Error, (_queue, error) => {
    logMusicError('Error event', error);
  });

  playerInstance.extractors.on('error', (_context, extractor, error) => {
    logMusicError(`Extractor ${extractor.identifier}`, error);
  });

  logger.info('[Music] Loading extractors...');
  const loadResult = await playerInstance.extractors.loadDefault((extractorName) => extractorName !== 'YouTubeExtractor');

  if (!loadResult?.success) {
    const message = loadResult?.error?.message ?? 'Unknown extractor error';
    logger.error(`[Music] Failed to load extractors: ${message}`);
    throw new Error(message);
  }

  await playerInstance.extractors.register(YoutubeExtractor, {});
  logger.info(`[Music] YouTube extractor registered: ${YoutubeExtractor.identifier}`);
  logger.info('[Music] Extractors loaded');
  logger.info('[Music] Player initialized');

  return playerInstance;
}

export function getPlayer() {
  return playerInstance;
}
