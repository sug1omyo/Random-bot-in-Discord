import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { leaveVoice } from '../voice/voiceManager.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Cho bot rời Voice Channel hiện tại');

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '❌ Lệnh này chỉ dùng được trong server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!leaveVoice(interaction.guildId, { manual: true })) {
    await interaction.reply({
      content: 'ℹ️ Bot hiện không ở Voice Channel nào.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply('👋 Đã rời Voice Channel.');
}
