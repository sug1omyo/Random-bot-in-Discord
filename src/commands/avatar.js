import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('avatar')
  .setDescription('Xem avatar của bạn hoặc một người dùng')
  .addUserOption((option) => option
    .setName('user')
    .setDescription('Người dùng cần xem avatar')
    .setRequired(false));

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const member = interaction.inGuild()
    ? await interaction.guild.members.fetch(user.id)
    : null;
  const avatarUrl = member?.avatar
    ? member.displayAvatarURL({ size: 4096 })
    : user.displayAvatarURL({ size: 4096 });
  const displayName = member?.displayName ?? user.globalName ?? user.username;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Avatar của ${displayName}`)
    .setDescription(`[Xem ảnh gốc](${avatarUrl})\n\nUser ID: \`${user.id}\``)
    .setImage(avatarUrl);

  await interaction.reply({ embeds: [embed] });
  logger.info(`[Command] /avatar displayed for ${user.tag}`);
}
