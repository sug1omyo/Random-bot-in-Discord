import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { debugQueue, getExistingGuildQueue } from '../music/musicManager.js';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Bỏ qua bài đang phát');

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
      logger.info('[Music Debug] /skip START');
    }
    const queue = getExistingGuildQueue(interaction.guildId, userChannel);
    if (!queue) {
      if (isMusicDebugEnabled()) {
        logger.info('[Music Queue] Queue exists: false');
      }
      await interaction.reply({
        content: 'ℹ️ Hiện không có bài nào để bỏ qua.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentTrack = queue.currentTrack;
    if (!currentTrack) {
      await interaction.reply({
        content: 'ℹ️ Hiện không có bài nào để bỏ qua.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (isMusicDebugEnabled()) {
      debugQueue(queue, 'BEFORE SKIP');
    }

    const skipped = queue.node.skip();

    if (isMusicDebugEnabled()) {
      logger.info(`[Music Debug] queue.node.skip() result: ${skipped}`);
      setTimeout(() => debugQueue(queue, 'AFTER SKIP'), 200);
    }
    await interaction.reply({
      content: skipped ? `⏭️ Đã bỏ qua: **${currentTrack.title}**` : '❌ Không thể bỏ qua bài hiện tại.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/skip', error);
    await interaction.reply({
      content: `❌ ${error instanceof Error ? error.message : 'Không thể bỏ qua bài hiện tại.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
