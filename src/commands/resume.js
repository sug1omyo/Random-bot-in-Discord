import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { debugQueue, getExistingGuildQueue } from '../music/musicManager.js';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Tiếp tục phát nhạc');

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
      logger.info('[Music Debug] /resume START');
    }
    const queue = getExistingGuildQueue(interaction.guildId, userChannel);
    if (isMusicDebugEnabled()) {
      logger.info(`[Music Queue] Queue exists: ${Boolean(queue)}`);
      debugQueue(queue, 'RESUME INSPECTION');
    }
    if (!queue) {
      await interaction.reply({
        content: 'ℹ️ Server này chưa có music queue.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!queue.currentTrack) {
      if (queue.tracks.size > 0) {
        if (isMusicDebugEnabled()) {
          logger.info('[Music Debug] currentTrack missing; starting the next queued track');
        }
        await queue.node.play();
        await interaction.reply({
          content: '▶️ Đã bắt đầu phát bài tiếp theo trong hàng chờ.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      } else {
        await interaction.reply({
          content: 'ℹ️ Hiện không có bài đang phát để tiếp tục.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (!queue.node.isPaused()) {
      await interaction.reply({
        content: 'ℹ️ Bài hiện tại không ở trạng thái tạm dừng.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const resumed = queue.node.resume();
    await interaction.reply({
      content: resumed ? '▶️ Tiếp tục phát nhạc.' : 'ℹ️ Nhạc không ở trạng thái tạm dừng.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/resume', error);
    await interaction.reply({
      content: `❌ ${error instanceof Error ? error.message : 'Không thể tiếp tục phát nhạc.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
