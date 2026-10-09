import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getExistingGuildQueue } from '../music/musicManager.js';
import { logMusicError } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Dừng nhạc nhưng giữ bot ở trong room');

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
    if (!queue) {
      await interaction.reply({
        content: 'ℹ️ Hiện không có nhạc để dừng. Bot vẫn ở trong Voice Channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    queue.node.stop();
    queue.clear();

    await interaction.reply({
      content: '⏹️ Đã dừng nhạc. Bot vẫn ở trong Voice Channel.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/stop', error);
    await interaction.reply({
      content: `❌ ${error instanceof Error ? error.message : 'Không thể dừng nhạc.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
