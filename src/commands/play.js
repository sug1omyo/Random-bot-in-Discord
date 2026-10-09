import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { QueryType } from 'discord-player';
import { YoutubeExtractor } from 'discord-player-youtubei';
import { getPlayer } from '../music/player.js';
import { enqueueTrack, getGuildQueue } from '../music/musicManager.js';
import { isMusicDebugEnabled, logMusicError, logger } from '../utils/logger.js';

const searchTimeoutMs = 30_000;
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com']);

export function normalizeYouTubeQuery(query) {
  let url;
  try {
    url = new URL(query);
  } catch {
    return { query, searchEngine: QueryType.YOUTUBE_SEARCH, isYouTubeUrl: false };
  }

  const hostname = url.hostname.toLowerCase();
  const isShortLink = hostname === 'youtu.be' || hostname === 'www.youtu.be';
  const isYouTubeHost = youtubeHosts.has(hostname);
  if (!isShortLink && !isYouTubeHost) {
    return { query, searchEngine: QueryType.YOUTUBE_SEARCH, isYouTubeUrl: false };
  }

  if (isYouTubeHost && url.pathname === '/playlist' && url.searchParams.has('list')) {
    return { query, searchEngine: QueryType.YOUTUBE_PLAYLIST, isYouTubeUrl: true };
  }

  const videoId = isShortLink
    ? url.pathname.split('/').filter(Boolean)[0]
    : url.pathname === '/watch'
      ? url.searchParams.get('v')
      : null;

  if (videoId) {
    return {
      query: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      searchEngine: QueryType.YOUTUBE_VIDEO,
      isYouTubeUrl: true,
    };
  }

  return { query, searchEngine: QueryType.YOUTUBE_SEARCH, isYouTubeUrl: false };
}

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Phát nhạc từ tên bài hoặc link')
  .addStringOption((option) => option
    .setName('query')
    .setDescription('Tên bài hát hoặc link')
    .setRequired(true));

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '❌ Lệnh này chỉ dùng được trong server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const query = interaction.options.getString('query', true).trim();
  if (!query) {
    await interaction.editReply('❌ Query không được để trống.');
    return;
  }

  try {
    const debug = isMusicDebugEnabled();
    if (debug) {
      logger.info('[Music Debug] /play START');
      logger.info(`[Music Debug] Guild: ${interaction.guildId}`);
      logger.info(`[Music Debug] Query: ${query}`);
    }

    const voiceState = interaction.guild.voiceStates.cache.get(interaction.user.id);
    const userChannel = voiceState?.channelId
      ? await interaction.guild.channels.fetch(voiceState.channelId)
      : null;

    if (!userChannel?.isVoiceBased()) {
      await interaction.editReply('❌ Bạn cần vào một Voice Channel trước.');
      return;
    }

    const player = getPlayer();
    if (!player) {
      throw new Error('Music system chưa sẵn sàng.');
    }

    const normalizedQuery = normalizeYouTubeQuery(query);
    const searchEngine = normalizedQuery.searchEngine;
    const isYouTubeUrl = normalizedQuery.isYouTubeUrl;
    if (debug) {
      logger.info(`[Music Debug] Search type: ${isYouTubeUrl ? 'URL' : 'TEXT'}`);
      logger.info('[Music Debug] Starting search...');
    }
    const queryKind = isYouTubeUrl ? 'YouTube URL' : 'YouTube search';
    if (isYouTubeUrl && debug) {
      logger.info(`[Music Debug] Original YouTube URL: ${query}`);
      logger.info(`[Music Debug] Normalized YouTube URL: ${normalizedQuery.query}`);
    }
    if (debug) {
      logger.info(`[Music Debug] /play ${queryKind} search started in guild ${interaction.guildId}`);
    }

    const youtubeExtractor = player.extractors.store.get(YoutubeExtractor.identifier);
    if (!youtubeExtractor) {
      throw new Error('YouTube extractor chưa được đăng ký.');
    }

    let searchTimeout;
    const searchResult = await Promise.race([
      youtubeExtractor.handle(normalizedQuery.query, {
        type: searchEngine,
        requestedBy: interaction.user,
      }),
      new Promise((_, reject) => {
        searchTimeout = setTimeout(
          () => reject(new Error('YouTube search timed out after 30 seconds.')),
          searchTimeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(searchTimeout));

    if (debug) {
      logger.info(`[Music Debug] Search returned: ${searchResult.tracks.length} track(s)`);
    }
    if (debug) {
      logger.info(`[Music Debug] Search extractor: ${YoutubeExtractor.identifier}`);
    }
    const track = searchResult?.tracks?.[0];

    if (!track) {
      throw new Error('Extractor YouTube không trả về track. Link có thể không khả dụng, bị giới hạn khu vực/độ tuổi, hoặc là định dạng chưa được hỗ trợ.');
    }

    if (debug) {
      logger.info(`[Music Debug] Selected: ${track.title}`);
    }
    const existingQueue = player.nodes.get(interaction.guildId);
    const queue = await getGuildQueue(interaction.guild, userChannel);
    await enqueueTrack(queue, track, Boolean(existingQueue));

    await interaction.editReply(`🎵 Đã thêm vào hàng chờ: **${track.title}**`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMusicError(`/play in guild ${interaction.guildId}`, error);
    await interaction.editReply(`❌ ${message || 'Không thể phát nhạc.'}`);
  }
}
