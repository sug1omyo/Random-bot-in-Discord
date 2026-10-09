import { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';

const READY_TIMEOUT_MS = 15_000;
const RECOVERY_WINDOW_MS = 5_000;
const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

const manuallyDisconnectedGuilds = new Set();
const reconnectingGuilds = new Set();
const desiredChannels = new Map();
const managedConnections = new Set();
const intentionalDestroyConnections = new WeakSet();
const reconnectTimers = new Map();
let shuttingDown = false;

export function getGuildVoiceConnection(guildId) {
  return getVoiceConnection(guildId);
}

function shouldStopReconnect(guildId) {
  return shuttingDown || manuallyDisconnectedGuilds.has(guildId);
}

function cancelReconnectDelay(guildId) {
  const pending = reconnectTimers.get(guildId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timer);
  reconnectTimers.delete(guildId);
  pending.resolve();
}

function waitBeforeReconnect(guildId, delay) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      reconnectTimers.delete(guildId);
      resolve();
    }, delay);
    timer.unref?.();
    reconnectTimers.set(guildId, { timer, resolve });
  });
}

function destroyConnection(connection) {
  if (connection.state.status === VoiceConnectionStatus.Destroyed) {
    return;
  }

  intentionalDestroyConnections.add(connection);
  connection.destroy();
  managedConnections.delete(connection);
}

function hasJoinPermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];
  return permissions?.has(required) ?? false;
}

function attachConnectionHandlers(connection, channel) {
  const guildId = channel.guild.id;
  let wasReady = connection.state.status === VoiceConnectionStatus.Ready;
  managedConnections.add(connection);

  connection.on('stateChange', (oldState, newState) => {
    logger.info(`[Voice Debug] ${oldState.status} -> ${newState.status}`);

    if (newState.status === VoiceConnectionStatus.Ready) {
      wasReady = true;
    }

    if (newState.status === VoiceConnectionStatus.Disconnected && 'closeCode' in newState) {
      logger.warn(`[Voice] Voice WebSocket closed with code ${newState.closeCode}`);
    }

    if (
      wasReady
      && newState.status !== VoiceConnectionStatus.Ready
      && newState.status !== VoiceConnectionStatus.Destroyed
      && oldState.status !== newState.status
    ) {
      void recoverConnection(connection);
    }

    if (newState.status === VoiceConnectionStatus.Destroyed) {
      managedConnections.delete(connection);
      if (wasReady && !intentionalDestroyConnections.has(connection)) {
        void recoverConnection(connection);
      }
    }
  });

  connection.on('error', (error) => {
    logger.error(`[Voice] Connection error: ${error.message}`);
  });

  logger.info(`[Voice Debug] state: ${connection.state.status}`);
}

async function createConnection(channel) {
  const guildId = channel.guild.id;
  if (shouldStopReconnect(guildId)) {
    throw new Error('Voice reconnect cancelled');
  }

  const botMember = channel.guild.members.me ?? await channel.guild.members.fetchMe();
  if (!hasJoinPermissions(channel, botMember)) {
    throw new Error(`Missing ViewChannel or Connect permission for ${channel.name}`);
  }
  if (shouldStopReconnect(guildId)) {
    throw new Error('Voice reconnect cancelled');
  }

  let connection;
  try {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    attachConnectionHandlers(connection, channel);

    if (!(await waitForConnectionReady(connection, READY_TIMEOUT_MS))) {
      throw new Error('Voice connection did not become ready before timeout');
    }
    if (
      shouldStopReconnect(guildId)
      || getVoiceConnection(guildId) !== connection
      || connection.state.status !== VoiceConnectionStatus.Ready
    ) {
      throw new Error('Voice connection was cancelled before becoming ready');
    }

    desiredChannels.set(guildId, {
      guild: channel.guild,
      channelId: channel.id,
      channelName: channel.name,
    });
    manuallyDisconnectedGuilds.delete(guildId);
    logger.info(`[Voice] Connected: ${channel.name}`);
    return connection;
  } catch (error) {
    if (connection && getVoiceConnection(guildId) === connection) {
      destroyConnection(connection);
    }
    throw error;
  }
}

async function resolveReconnectChannel(guildId) {
  const previous = desiredChannels.get(guildId);
  if (previous) {
    try {
      const channel = await previous.guild.channels.fetch(previous.channelId);
      if (channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice) {
        return channel;
      }
      logger.warn('[Voice] Previous channel is no longer available; checking configured fallback');
    } catch (error) {
      logger.warn(`[Voice] Could not fetch previous channel: ${error.message}`);
    }
  }

  const configuredGuildId = process.env.GUILD_ID?.trim();
  const configuredChannelId = process.env.VOICE_CHANNEL_ID?.trim();
  const autoJoinEnabled = process.env.AUTO_JOIN?.trim().toLowerCase() === 'true';
  if (!autoJoinEnabled || !configuredGuildId || !configuredChannelId || configuredGuildId !== guildId) {
    return null;
  }

  try {
    const fallbackGuild = previous?.guild;
    if (!fallbackGuild) {
      return null;
    }

    const channel = await fallbackGuild.channels.fetch(configuredChannelId);
    return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice
      ? channel
      : null;
  } catch (error) {
    logger.warn(`[Voice] Could not fetch configured fallback channel: ${error.message}`);
    return null;
  }
}

async function waitForConnectionReady(connection, timeout) {
  if (connection.state.status === VoiceConnectionStatus.Ready) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      connection.off('stateChange', onStateChange);
      resolve(ready);
    };
    const onStateChange = (_oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Ready) {
        finish(true);
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        finish(false);
      }
    };
    const timer = setTimeout(() => {
      finish(connection.state.status === VoiceConnectionStatus.Ready);
    }, timeout);

    connection.on('stateChange', onStateChange);
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      finish(true);
    } else if (connection.state.status === VoiceConnectionStatus.Destroyed) {
      finish(false);
    }
  });
}

async function recoverConnection(connection) {
  const guildId = connection.joinConfig.guildId;
  if (reconnectingGuilds.has(guildId) || shouldStopReconnect(guildId)) {
    return;
  }

  reconnectingGuilds.add(guildId);
  logger.warn('[Voice] Connection lost');
  logger.info('[Voice] Waiting for automatic recovery...');

  try {
    if (await waitForConnectionReady(connection, RECOVERY_WINDOW_MS)) {
      logger.info('[Voice] Connection recovered');
      return;
    }

    for (let index = 0; index < RECONNECT_DELAYS_MS.length; index += 1) {
      if (shouldStopReconnect(guildId)) {
        return;
      }

      const attempt = index + 1;
      await waitBeforeReconnect(guildId, RECONNECT_DELAYS_MS[index]);
      if (shouldStopReconnect(guildId)) {
        return;
      }

      if (connection.state.status === VoiceConnectionStatus.Ready) {
        logger.info('[Voice] Connection recovered');
        return;
      }

      logger.warn(`[Voice] Reconnect attempt ${attempt}/${RECONNECT_DELAYS_MS.length}`);

      try {
        let currentConnection = getVoiceConnection(guildId);

        if (currentConnection && currentConnection !== connection) {
          if (await waitForConnectionReady(currentConnection, READY_TIMEOUT_MS)) {
            const target = desiredChannels.get(guildId);
            logger.info(`[Voice] Reconnected successfully: ${target?.channelName ?? 'voice channel'}`);
            return currentConnection;
          }

          if (getVoiceConnection(guildId) === currentConnection) {
            destroyConnection(currentConnection);
          }

          currentConnection = null;
        }

        currentConnection ??= getVoiceConnection(guildId);
        if (currentConnection === connection && currentConnection.state.status !== VoiceConnectionStatus.Destroyed) {
          if (currentConnection.state.status === VoiceConnectionStatus.Disconnected) {
            if (
              currentConnection.rejoin()
              && await waitForConnectionReady(currentConnection, READY_TIMEOUT_MS)
            ) {
              logger.info(`[Voice] Reconnected successfully: ${desiredChannels.get(guildId)?.channelName ?? 'voice channel'}`);
              return;
            }
          } else if (await waitForConnectionReady(currentConnection, READY_TIMEOUT_MS)) {
            logger.info('[Voice] Connection recovered');
            return;
          }

          if (getVoiceConnection(guildId) === currentConnection) {
            destroyConnection(currentConnection);
          }
        }

        if (shouldStopReconnect(guildId)) {
          return;
        }

        const channel = await resolveReconnectChannel(guildId);
        if (!channel) {
          throw new Error('No valid previous or configured voice channel is available');
        }

        currentConnection = await createConnection(channel);
        logger.info(`[Voice] Reconnected successfully: ${channel.name}`);
        return currentConnection;
      } catch (error) {
        if (shouldStopReconnect(guildId)) {
          return;
        }
        logger.warn(`[Voice] Reconnect attempt ${attempt} failed: ${error.message}`);
      }
    }

    logger.error(`[Voice] Failed to reconnect after ${RECONNECT_DELAYS_MS.length} attempts`);
  } finally {
    reconnectingGuilds.delete(guildId);
  }
}

export async function joinChannel(channel) {
  const guildId = channel.guild.id;
  manuallyDisconnectedGuilds.delete(guildId);
  const currentConnection = getVoiceConnection(guildId);

  if (currentConnection?.joinConfig.channelId === channel.id) {
    if (await waitForConnectionReady(currentConnection, READY_TIMEOUT_MS)) {
    if (
      shouldStopReconnect(guildId)
      || getVoiceConnection(guildId) !== currentConnection
      || currentConnection.state.status !== VoiceConnectionStatus.Ready
    ) {
      throw new Error('Voice connection was cancelled before becoming ready');
    }

    desiredChannels.set(guildId, {
      guild: channel.guild,
      channelId: channel.id,
      channelName: channel.name,
    });
      manuallyDisconnectedGuilds.delete(guildId);
      return currentConnection;
    }

    if (getVoiceConnection(guildId) === currentConnection) {
      destroyConnection(currentConnection);
    }
  } else if (currentConnection) {
    destroyConnection(currentConnection);
    logger.info('[Voice] Disconnected');
  }

  logger.info(`[Voice] Joining: ${channel.name}`);

  try {
    return await createConnection(channel);
  } catch (error) {
    const failedConnection = getVoiceConnection(guildId);
    if (failedConnection?.joinConfig.channelId === channel.id) {
      destroyConnection(failedConnection);
    }

    logger.error(`[Voice] Failed to connect: ${error.message}`);
    throw error;
  }
}

export function leaveVoice(guildId, { manual = true } = {}) {
  if (manual) {
    manuallyDisconnectedGuilds.add(guildId);
    desiredChannels.delete(guildId);
    cancelReconnectDelay(guildId);
    logger.info('[Voice] Manual disconnect requested');
  }

  const connection = getVoiceConnection(guildId);
  if (!connection) {
    return false;
  }

  destroyConnection(connection);
  logger.info('[Voice] Disconnected');
  return true;
}

export function shutdownVoiceConnections() {
  shuttingDown = true;

  for (const guildId of reconnectingGuilds) {
    cancelReconnectDelay(guildId);
  }

  for (const connection of managedConnections) {
    try {
      destroyConnection(connection);
    } catch (error) {
      logger.warn(`[Voice] Failed to destroy connection during shutdown: ${error.message}`);
    }
  }

  desiredChannels.clear();
  manuallyDisconnectedGuilds.clear();
}
