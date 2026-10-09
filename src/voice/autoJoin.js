import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildVoiceConnection, joinChannel } from './voiceManager.js';

export async function autoJoin(client) {
  if (process.env.AUTO_JOIN?.trim().toLowerCase() !== 'true') {
    logger.info('[Voice] Auto Join disabled');
    return;
  }

  logger.info('[Voice] Auto Join enabled');

  const guildId = process.env.GUILD_ID?.trim();
  const channelId = process.env.VOICE_CHANNEL_ID?.trim();
  if (!channelId) {
    logger.warn('[Voice] Auto Join enabled but VOICE_CHANNEL_ID is missing');
    return;
  }

  if (!guildId) {
    logger.error('[Voice] Auto Join failed: GUILD_ID is missing');
    return;
  }

  try {
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
    if (!guild) {
      logger.error('[Voice] Configured guild not found');
      return;
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      logger.error('[Voice] Configured channel not found');
      return;
    }

    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      logger.error('[Voice] Configured channel is not a Voice Channel');
      return;
    }

    const currentConnection = getGuildVoiceConnection(guild.id);
    if (currentConnection?.joinConfig.channelId === channel.id) {
      logger.info('[Voice] Already connected to configured channel');
      await joinChannel(channel);
      return;
    }

    const botMember = guild.members.me ?? await guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
    ];

    if (!permissions?.has(requiredPermissions)) {
      logger.warn(`[Voice] Missing permission to join channel: ${channel.name}`);
      return;
    }

    logger.info(`[Voice] Joining configured channel: ${channel.name}`);
    await joinChannel(channel);
  } catch (error) {
    logger.error(`[Voice] Auto Join failed: ${error.message}`);
  }
}
