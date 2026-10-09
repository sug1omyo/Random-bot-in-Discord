import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { debugQueue, getExistingGuildQueue, toDisplayDuration } from '../music/musicManager.js';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Hiển thị bài đang phát');

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
      logger.info('[Music Debug] /nowplaying START');
    }
    const queue = getExistingGuildQueue(interaction.guildId, userChannel);
    if (isMusicDebugEnabled()) {
      logger.info(`[Music Queue] Queue exists: ${Boolean(queue)}`);
      debugQueue(queue, '/nowplaying inspection');
    }
    if (!queue) {
      await interaction.reply({
        content: 'ℹ️ Server này chưa có music queue.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const track = queue.currentTrack;

    if (!track) {
      await interaction.reply({
        content: queue.tracks.size
          ? `ℹ️ Không có bài nào đang phát. Có ${queue.tracks.size} bài đang chờ trong queue.`
          : 'ℹ️ Hiện không có bài nào đang phát.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const safeDuration = toDisplayDuration(track.duration ?? track.durationMS ?? 'N/A');
    await interaction.reply({
      content: `🎵 Đang phát: **${track.title}**\n🎤 Tác giả: ${track.author || 'Unknown'}\n⏱️ Thời lượng: ${safeDuration}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/nowplaying', error);
    await interaction.reply({
      content: `❌ ${error.message || 'Không thể hiển thị bài đang phát.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
