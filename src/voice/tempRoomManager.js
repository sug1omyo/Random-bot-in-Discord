import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';

const EMPTY_ROOM_DELETE_DELAY_MS = 2_500;
const temporaryRoomIds = new Set();
const creationLocks = new Set();
const deletionTimers = new Map();

let triggerChannel = null;

function isEnabled() {
  return process.env.TEMP_ROOM_ENABLED?.trim().toLowerCase() === 'true';
}

function requiredPermissionsForRoom() {
  return [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.ManageChannels,
  ];
}

function getMissingPermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  return requiredPermissionsForRoom().filter((permission) => !permissions?.has(permission));
}

function permissionNames(permissions) {
  const names = new Map([
    [PermissionFlagsBits.ViewChannel, 'View Channels'],
    [PermissionFlagsBits.Connect, 'Connect'],
    [PermissionFlagsBits.MoveMembers, 'Move Members'],
    [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  ]);
  return permissions.map((permission) => names.get(permission) ?? permission.toString());
}

function getRoomName(displayName) {
  return Array.from(`🔊・Phòng của ${displayName}`).slice(0, 100).join('');
}

async function resolveParentId(guild, channel) {
  const configuredCategoryId = process.env.TEMP_ROOM_CATEGORY_ID?.trim();
  if (!configuredCategoryId) {
    return channel.parentId;
  }

  try {
    const category = await guild.channels.fetch(configuredCategoryId);
    if (category?.type === ChannelType.GuildCategory) {
      return category.id;
    }
  } catch (error) {
    logger.warn(`[TempRoom] Configured category could not be fetched: ${error.message}`);
  }

  logger.warn('[TempRoom] Configured category is invalid; using trigger channel category');
  return channel.parentId;
}

async function deleteIfEmpty(channelId, guild, immediate = false) {
  const timer = deletionTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    deletionTimers.delete(channelId);
  }

  const removeRoom = async () => {
    deletionTimers.delete(channelId);
    if (!temporaryRoomIds.has(channelId)) {
      return;
    }

    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel) {
        temporaryRoomIds.delete(channelId);
        return;
      }

      if (channel.members.size !== 0) {
        return;
      }

      logger.info(`[TempRoom] Room empty, deleting: ${channel.name}`);
      await channel.delete('Temporary voice room is empty');
      temporaryRoomIds.delete(channelId);
      logger.info(`[TempRoom] Deleted temporary room: ${channel.name}`);
    } catch (error) {
      logger.error(`[TempRoom] Failed to delete room: ${error.message}`);
    }
  };

  if (immediate) {
    await removeRoom();
    return;
  }

  logger.info(`[TempRoom] Room empty, scheduling deletion: ${channelId}`);
  const scheduled = setTimeout(() => {
    void removeRoom();
  }, EMPTY_ROOM_DELETE_DELAY_MS);
  scheduled.unref?.();
  deletionTimers.set(channelId, scheduled);
}

async function createRoomForMember(member, guild) {
  if (!triggerChannel || member.voice.channelId !== triggerChannel.id) {
    return;
  }

  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const missingPermissions = getMissingPermissions(triggerChannel, botMember);
  if (missingPermissions.length > 0) {
    logger.warn(`[TempRoom] Missing permissions: ${permissionNames(missingPermissions).join(', ')}`);
    return;
  }

  const roomName = getRoomName(member.displayName);
  let room;

  try {
    logger.info(`[TempRoom] Creating room for ${member.displayName}`);
    const parentId = await resolveParentId(guild, triggerChannel);
    const permissionOverwrites = [...triggerChannel.permissionOverwrites.cache.values()]
      .map(({ id, allow, deny, type }) => ({
        id,
        allow: allow.bitfield,
        deny: deny.bitfield,
        type,
      }));

    room = await guild.channels.create({
      name: roomName,
      type: ChannelType.GuildVoice,
      parent: parentId,
      permissionOverwrites,
      reason: `Temporary voice room for ${member.user.tag}`,
    });
    temporaryRoomIds.add(room.id);
    logger.info(`[TempRoom] Created: ${room.name}`);
  } catch (error) {
    logger.error(`[TempRoom] Failed to create room: ${error.message}`);
    return;
  }

  try {
    const currentMember = await guild.members.fetch(member.id);
    if (currentMember.voice.channelId !== triggerChannel.id) {
      logger.info('[TempRoom] User left trigger before move completed');
      await deleteIfEmpty(room.id, guild, true);
      return;
    }

    const roomPermissions = getMissingPermissions(room, botMember);
    if (roomPermissions.length > 0) {
      logger.warn(`[TempRoom] Missing permissions in created room: ${permissionNames(roomPermissions).join(', ')}`);
      await deleteIfEmpty(room.id, guild, true);
      return;
    }

    await currentMember.voice.setChannel(room, 'Move member into their temporary voice room');
    logger.info(`[TempRoom] Moved ${currentMember.displayName} to temporary room`);
  } catch (error) {
    logger.error(`[TempRoom] Failed to move member: ${error.message}`);
    await deleteIfEmpty(room.id, guild, true);
  }
}

export async function initializeTempRooms(client) {
  triggerChannel = null;

  if (!isEnabled()) {
    logger.info('[TempRoom] Join-to-create disabled');
    return;
  }

  logger.info('[TempRoom] Join-to-create enabled');

  const triggerChannelId = process.env.TEMP_ROOM_TRIGGER_CHANNEL_ID?.trim();
  if (!triggerChannelId) {
    logger.warn('[TempRoom] Enabled but TEMP_ROOM_TRIGGER_CHANNEL_ID is missing');
    return;
  }

  try {
    const channel = await client.channels.fetch(triggerChannelId);
    if (!channel) {
      logger.warn('[TempRoom] Trigger channel not found');
      return;
    }

    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      logger.warn('[TempRoom] Trigger channel is not a Voice Channel');
      return;
    }

    triggerChannel = channel;
    logger.info(`[TempRoom] Trigger channel: ${channel.name}`);
    logger.info(`[TempRoom] Join-to-create ready: ${channel.name}`);
  } catch (error) {
    if (error.code === 10003) {
      logger.warn('[TempRoom] Trigger channel not found');
      return;
    }

    logger.error(`[TempRoom] Failed to fetch trigger channel: ${error.message}`);
  }
}

export async function handleVoiceStateUpdate(oldState, newState) {
  if (!isEnabled()) {
    return;
  }

  const departedRoomId = oldState.channelId;
  if (departedRoomId && temporaryRoomIds.has(departedRoomId)) {
    const departedChannel = oldState.channel;
    if (departedChannel?.members.size === 0) {
      await deleteIfEmpty(departedRoomId, oldState.guild);
    }
  }

  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) {
    return;
  }

  const joinedTrigger = triggerChannel
    && newState.channelId === triggerChannel.id
    && oldState.channelId !== newState.channelId;

  if (joinedTrigger && !creationLocks.has(member.id)) {
    creationLocks.add(member.id);
    try {
      await createRoomForMember(member, newState.guild);
    } catch (error) {
      logger.error(`[TempRoom] Failed to create room: ${error.message}`);
    } finally {
      creationLocks.delete(member.id);
    }
  }
}
