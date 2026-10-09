import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildVoiceConnection, joinChannel } from '../voice/voiceManager.js';

export const data = new SlashCommandBuilder()
  .setName('join')
  .setDescription('Cho bot vào Voice Channel của bạn');

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '❌ Lệnh này chỉ dùng được trong server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const voiceState = interaction.guild.voiceStates.cache.get(interaction.user.id);
  const channelId = voiceState?.channelId;
  if (!channelId) {
    await interaction.reply({
      content: '❌ Bạn cần vào một Voice Channel trước.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(channelId);
  if (!channel?.isVoiceBased()) {
    await interaction.reply({
      content: '❌ Không tìm thấy Voice Channel của bạn.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  const requiredPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
  ];
  if (!permissions?.has(requiredPermissions)) {
    await interaction.reply({
      content: '❌ Bot cần quyền View Channel và Connect trong Voice Channel này.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentConnection = getGuildVoiceConnection(interaction.guildId);
  if (currentConnection?.joinConfig.channelId === channel.id) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await joinChannel(channel);
      await interaction.editReply('ℹ️ Bot đã ở trong voice channel này rồi.');
    } catch {
      await interaction.editReply('❌ Không thể kết nối Voice Channel.');
    }
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await joinChannel(channel);
    await interaction.editReply(`🔊 Đã vào voice channel: ${channel.name}`);
  } catch {
    await interaction.editReply('❌ Không thể kết nối Voice Channel.');
  }
}
