import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { QueueRepeatMode } from 'discord-player';
import { getGuildQueue } from '../music/musicManager.js';
import { logMusicError } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('loop')
  .setDescription('Bật hoặc tắt chế độ lặp nhạc')
  .addStringOption((option) => option
    .setName('mode')
    .setDescription('Chế độ lặp')
    .setRequired(true)
    .addChoices(
      { name: 'off', value: 'off' },
      { name: 'track', value: 'track' },
      { name: 'queue', value: 'queue' },
    ));

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
    const queue = await getGuildQueue(interaction.guild, userChannel);
    const modeValue = interaction.options.getString('mode', true).toLowerCase();
    const modes = {
      off: QueueRepeatMode.OFF,
      track: QueueRepeatMode.TRACK,
      queue: QueueRepeatMode.QUEUE,
    };

    const repeatMode = modes[modeValue];
    if (repeatMode === undefined) {
      throw new Error('❌ Chế độ lặp không hợp lệ.');
    }

    queue.setRepeatMode(repeatMode);
    await interaction.reply({
      content: `🔁 Đã đặt chế độ lặp: **${modeValue}**`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logMusicError('/loop', error);
    await interaction.reply({
      content: `❌ ${error.message || 'Không thể cập nhật chế độ lặp.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
