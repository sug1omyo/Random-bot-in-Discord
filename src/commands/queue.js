import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { debugQueue, getExistingGuildQueue, toDisplayDuration } from '../music/musicManager.js';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Xem danh sách nhạc đang chờ');

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '❌ Lệnh này chỉ dùng được trong server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const voiceState = interaction.guild.voiceStates.cache.get(interaction.user.id);
  const userChannel = voiceState?.channelId
    ? await interaction.guild.channels.fetch(voiceState.channelId)
    : null;

  if (!userChannel?.isVoiceBased()) {
    await interaction.reply({
      content: '❌ Bạn cần vào một Voice Channel trước.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const queue = getExistingGuildQueue(interaction.guildId, userChannel);
    if (isMusicDebugEnabled()) {
      logger.info('[Music Queue] /queue inspection');
      logger.info(`[Music Queue] Queue exists: ${Boolean(queue)}`);
      debugQueue(queue, '/queue inspection');
    }
    const currentTrack = queue?.currentTrack;
    const allUpcoming = queue?.tracks.toArray() ?? [];
    const upcoming = allUpcoming.slice(0, 10);

    let message = '📋 Hàng chờ nhạc:\n';
    if (currentTrack) {
      message += `🎵 Đang phát: **${currentTrack.title}** — ${toDisplayDuration(currentTrack.duration ?? currentTrack.durationMS ?? 'N/A')}\n`;
    } else if (allUpcoming.length) {
      const queuedNext = allUpcoming[0];
      message += `🎵 Queue đang có bài sắp phát: **${queuedNext.title}**\n`;
    } else {
      message += '🎵 Không có bài nào đang phát.\n';
    }

    if (!allUpcoming.length) {
      message += 'Queue hiện tại đang trống.';
    } else {
      message += upcoming.map((track, index) => `${index + 1}. ${track.title}`).join('\n');
    }

    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/queue', error);
    await interaction.reply({
      content: `❌ ${error instanceof Error ? error.message : 'Không thể xem queue.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
