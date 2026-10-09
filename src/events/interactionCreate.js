import { Events, InteractionType, MessageFlags } from 'discord.js';
import { logMusicError, logger } from '../utils/logger.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, client) {
  if (!interaction.isChatInputCommand() || interaction.type !== InteractionType.ApplicationCommand) {
    return;
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return;
  }

  logger.info(`[Command] /${interaction.commandName} used by ${interaction.user.tag}`);

  try {
    await command.execute(interaction);
  } catch (error) {
    if (['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'nowplaying', 'loop'].includes(interaction.commandName)) {
      logMusicError(`Unhandled /${interaction.commandName} command error`, error);
    }
    logger.error(`Command /${interaction.commandName} failed: ${error instanceof Error ? error.message : String(error)}`);

    const response = {
      content: 'Có lỗi xảy ra khi chạy command này.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
}
