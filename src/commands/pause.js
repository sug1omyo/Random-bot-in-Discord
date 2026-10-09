import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { debugQueue, getGuildQueue } from '../music/musicManager.js';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Tạm dừng nhạc hiện tại');

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
    if (isMusicDebugEnabled()) {
      logger.info('[Music Debug] /pause START');
    }
    const queue = await getGuildQueue(interaction.guild, userChannel);
    if (isMusicDebugEnabled()) {
      debugQueue(queue, 'PAUSE INSPECTION');
    }
    if (!queue.currentTrack || !queue.isPlaying()) {
      await interaction.reply({
        content: 'ℹ️ Hiện không có nhạc nào đang phát.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const paused = queue.node.pause();
    await interaction.reply({
      content: paused ? '⏸️ Đã tạm dừng nhạc.' : 'ℹ️ Nhạc đang ở trạng thái chưa thể tạm dừng.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/pause', error);
    await interaction.reply({
      content: `❌ ${error.message || 'Không thể tạm dừng nhạc.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
