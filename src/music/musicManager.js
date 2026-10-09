import { getGuildVoiceConnection, joinChannel } from '../voice/voiceManager.js';
import { getPlayer } from './player.js';
import { isMusicDebugEnabled, logger } from '../utils/logger.js';

const loggedDispatchers = new WeakSet();
const queueTransitionDispatchers = new WeakSet();

function attachDispatcherDiagnostics(queue) {
  if (!queue.dispatcher) {
    return;
  }

  const dispatcher = queue.dispatcher;

  if (!queueTransitionDispatchers.has(dispatcher)) {
    queueTransitionDispatchers.add(dispatcher);
    dispatcher.on('finish', (resource) => {
      const finishedTitle = resource?.metadata?.title ?? 'unknown track';
      if (isMusicDebugEnabled()) {
        logger.info(`[Music Dispatcher] finish: ${finishedTitle}`);
      }

      setImmediate(() => {
        const entry = queue.tasksQueue.acquire();
        void entry.getTask()
          .then(async () => {
            if (queue.deleted || queue.dispatcher !== dispatcher) {
              return;
            }

            const currentTitle = queue.currentTrack?.title ?? 'none';
            const upcomingCount = queue.tracks.size;
            if (isMusicDebugEnabled()) {
              logger.info('[Music Queue] Advance requested: dispatcher-finish');
              logger.info(`[Music Queue] Current: ${currentTitle}`);
              logger.info(`[Music Queue] Upcoming: ${upcomingCount}`);
              logger.info(`[Music Queue] Playing: ${queue.isPlaying()}`);
              logger.info(`[Music Queue] Idle: ${queue.node.isIdle()}`);
            }

            if (upcomingCount === 0 || queue.isPlaying()) {
              if (isMusicDebugEnabled() && upcomingCount === 0) {
                logger.info('[Music Queue] Dispatcher finish -> queue empty');
              }
              return;
            }

            if (isMusicDebugEnabled()) {
              logger.info('[Music Queue] Dispatcher finish -> advancing with queue.node.play()');
            }

            await queue.node.play();

            if (isMusicDebugEnabled()) {
              logger.info(`[Music Queue] Native transition started: ${queue.currentTrack?.title ?? 'unknown'}`);
              logger.info(`[Music Queue] Upcoming after transition: ${queue.tracks.size}`);
            }
          })
          .catch((error) => {
            logger.error(`[Music Queue] Dispatcher transition failed: ${error?.stack ?? error}`);
          })
          .finally(() => {
            queue.tasksQueue.release();
          });
      });
    });
  }

  if (!isMusicDebugEnabled() || loggedDispatchers.has(dispatcher)) {
    return;
  }
  loggedDispatchers.add(dispatcher);

  dispatcher.on('debug', (message) => {
    logger.info(`[Music Dispatcher] ${message}`);
  });
  dispatcher.on('error', (error) => {
    logger.error(`[Music Dispatcher] error: ${error.message}`);
  });
  dispatcher.on('start', (resource) => {
    logger.info(`[Music Dispatcher] start: ${resource.metadata?.title ?? 'unknown track'}`);
  });
  dispatcher.audioPlayer.on('stateChange', (oldState, newState) => {
    logger.info(`[Music Audio] ${oldState.status} -> ${newState.status}`);
  });
  dispatcher.audioPlayer.on('error', (error) => {
    logger.error(`[Music Audio] error: ${error.message}`);
  });
}

export function debugQueue(queue, label, exists = Boolean(queue)) {
  if (!isMusicDebugEnabled()) {
    return;
  }

  const current = queue?.currentTrack?.title ?? 'none';
  const upcoming = queue?.tracks.toArray().map((track) => track.title) ?? [];
  logger.info(`[Music Queue] ${label}`);
  logger.info(`[Music Queue] Exists: ${exists}`);
  logger.info(`[Music Queue] Current: ${current}`);
  logger.info(`[Music Queue] Upcoming count: ${upcoming.length}`);
  logger.info(`[Music Queue] Upcoming: ${upcoming.length ? upcoming.map((title, index) => `${index + 1}. ${title}`).join(' | ') : 'none'}`);
  logger.info(`[Music Queue] Playing: ${queue?.isPlaying() ?? false}`);
  logger.info(`[Music Queue] Paused: ${queue?.node.isPaused() ?? false}`);
  logger.info(`[Music Queue] Repeat mode: ${queue?.repeatMode ?? 'none'}`);
  logger.info(`[Music Queue] Dispatcher exists: ${Boolean(queue?.dispatcher)}`);
}

export async function getGuildQueue(guild, voiceChannel) {
  const player = getPlayer();
  if (!player) {
    throw new Error('❌ Music system chưa sẵn sàng.');
  }

  let queue = player.nodes.get(guild.id);
  if (!queue) {
    queue = player.nodes.create(guild, {
      leaveOnEnd: false,
      leaveOnStop: false,
      leaveOnEmpty: false,
      metadata: { guildId: guild.id },
    });
  }

  const currentConnection = getGuildVoiceConnection(guild.id);

  if (!currentConnection) {
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      throw new Error('❌ Bot chưa ở Voice Channel nào và bạn chưa ở trong channel nào.');
    }

    await joinChannel(voiceChannel);
    const joinedConnection = getGuildVoiceConnection(guild.id);
    if (!joinedConnection) {
      throw new Error('❌ Không thể kết nối Voice Channel của bạn.');
    }

    if (queue.dispatcher?.voiceConnection !== joinedConnection) {
      if (isMusicDebugEnabled()) {
        logger.info('[Music Dispatcher] Creating dispatcher');
        logger.info(`[Music Dispatcher] Existing dispatcher: ${Boolean(queue.dispatcher)}`);
        logger.info(`[Music Dispatcher] Voice connection status: ${joinedConnection.state.status}`);
      }
      queue.createDispatcher(joinedConnection);
    }
    attachDispatcherDiagnostics(queue);

    return queue;
  }

  if (voiceChannel && currentConnection.joinConfig.channelId !== voiceChannel.id) {
    throw new Error('❌ Bạn cần ở cùng Voice Channel với bot.');
  }

  if (queue.dispatcher?.voiceConnection !== currentConnection) {
    if (isMusicDebugEnabled()) {
      logger.info('[Music Dispatcher] Creating dispatcher');
      logger.info(`[Music Dispatcher] Existing dispatcher: ${Boolean(queue.dispatcher)}`);
      logger.info(`[Music Dispatcher] Voice connection status: ${currentConnection.state.status}`);
    }
    queue.createDispatcher(currentConnection);
    attachDispatcherDiagnostics(queue);
  } else {
    attachDispatcherDiagnostics(queue);
  }

  return queue;
}

export function getExistingGuildQueue(guildId, voiceChannel) {
  const player = getPlayer();
  if (!player) {
    throw new Error('❌ Music system chưa sẵn sàng.');
  }

  const queue = player.nodes.get(guildId);
  if (!queue) {
    return null;
  }

  if (!queue.channel || queue.channel.id !== voiceChannel.id) {
    throw new Error('❌ Bạn cần ở cùng Voice Channel với bot.');
  }

  return queue;
}

export async function ensureQueuePlayback(queue) {
  if (!queue) {
    return false;
  }

  if (queue.isPlaying()) {
    if (isMusicDebugEnabled()) {
      logger.info('[Music Debug] Player already active; track stays queued');
    }
    return true;
  }

  if (queue.tracks.size === 0) {
    if (isMusicDebugEnabled()) {
      logger.info('[Music Debug] No queued track available to start');
    }
    return false;
  }

  if (isMusicDebugEnabled()) {
    logger.info('[Music Debug] Queue not playing; starting next queued track');
    logger.info('[Music Debug] Calling queue.node.play()');
  }

  await queue.node.play();

  if (isMusicDebugEnabled()) {
    logger.info('[Music Debug] queue.node.play() resolved');
  }

  return true;
}

export async function enqueueTrack(queue, track, queueExisted = true) {
  const entry = queue.tasksQueue.acquire();

  try {
    await entry.getTask();
    const currentTrackId = queue.currentTrack?.id;
    const queuedTrackIds = queue.tracks.toArray().map((queuedTrack) => queuedTrack.id);
    const isDuplicate = currentTrackId === track.id || queuedTrackIds.includes(track.id);

    if (isDuplicate) {
      if (isMusicDebugEnabled()) {
        logger.warn(`[Music Queue] Ignoring duplicate track: ${track.title}`);
      }
      return;
    }

    debugQueue(queue, 'BEFORE ADD', queueExisted);
    queue.addTrack(track);
    debugQueue(queue, 'AFTER ADD');

    if (isMusicDebugEnabled()) {
      logger.info(`[Music Queue] Current after add: ${queue.currentTrack?.title ?? 'none'}`);
      logger.info(`[Music Queue] Upcoming after add: ${queue.tracks.size}`);
    }

    await ensureQueuePlayback(queue);
    debugQueue(queue, 'AFTER PLAY CHECK');
  } finally {
    queue.tasksQueue.release();
  }
}

export function toDisplayDuration(duration) {
  if (typeof duration === 'number') {
    const totalSeconds = Math.max(0, Math.floor(duration / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
    }

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return duration ?? 'N/A';
}
