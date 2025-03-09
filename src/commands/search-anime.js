import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import axios from 'axios';

// AnimeSchedule API Configuration for fetching timetable
const API_KEY = process.env.ANIMESCHEDULE_TOKEN;
const BASE_URL = 'https://animeschedule.net/api/v3';

export default {
  data: new SlashCommandBuilder()
    .setName('search-anime')
    .setDescription('Fetch anime details from Jikan API')
    .addStringOption(option =>
      option.setName('anime')
        .setDescription('Anime name')
        .setRequired(true)),
  
  async execute(interaction) {
    const query = interaction.options.getString('anime');
    if (!query) {
      await interaction.reply({ content: 'Please provide an anime name.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      // Fetch anime details from Jikan API
      const jikanResponse = await axios.get('https://api.jikan.moe/v4/anime', {
        params: { q: query, limit: 10 },
      });

      const animeList = jikanResponse.data.data;
      if (!animeList || animeList.length === 0) {
        await interaction.editReply('No results found.');
        return;
      }

      // Create buttons for selection
      const buttons = animeList.map(anime => {
        let title = anime.title.length > 80 ? anime.title.substring(0, 77) + '...' : anime.title;
        return new ButtonBuilder()
          .setCustomId(`anime_${anime.mal_id}`)
          .setLabel(title)
          .setStyle(ButtonStyle.Primary);
      });

      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }

      await interaction.editReply({ content: 'Select an anime to view details:', components: rows });

      const filter = i => i.customId.startsWith('anime_') && i.user.id === interaction.user.id;
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async i => {
        try {
          
          await i.update({ content: 'Fetching anime details...', components: [] });

          const animeId = i.customId.split('_')[1];
          const selectedAnime = animeList.find(anime => String(anime.mal_id) === animeId);

          if (!selectedAnime) {
            return await i.followUp({ content: 'Anime not found.', ephemeral: true });
          }

          // Clean up the synopsis
          let cleanSynopsis = selectedAnime.synopsis
            ? selectedAnime.synopsis.replace(/<\/?[^>]+(>|$)/g, '')
            : 'No description available.';
          if (cleanSynopsis.length > 500) {
            cleanSynopsis = cleanSynopsis.substring(0, 200) + '...';
          }

          let status = selectedAnime.status || 'Unknown';
          let nextEpisode = '';

          if (status.toLowerCase() === 'currently airing') {
            try {
              // Fetch timetable from AnimeSchedule API
              const timetableResponse = await axios.get(`${BASE_URL}/timetables/sub`, {
                headers: { 'Authorization': `Bearer ${API_KEY}` }
              });

              const scheduleData = timetableResponse.data;
              if (scheduleData && scheduleData.length > 0) {
                const scheduledAnime = scheduleData.find(a => a.title.toLowerCase() === selectedAnime.title.toLowerCase());
                if (scheduledAnime) {
                  const episodeDate = new Date(scheduledAnime.episodeDate);
                  const formattedDate = `${episodeDate.getMonth() + 1}/${episodeDate.getDate()}/${episodeDate.getFullYear()}, ${episodeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`;

                  nextEpisode = `**Episode ${scheduledAnime.episodeNumber || 'TBA'}** - ${formattedDate}`;
                } else {
                  nextEpisode = '**Next Episode:** To be aired.';
                }
              } else {
                nextEpisode = '**Next Episode:** To be aired.';
              }
            } catch (scheduleError) {
              console.error('Error fetching anime schedule:', scheduleError.response ? scheduleError.response.data : scheduleError);
            }
          }

          if (status.toLowerCase() === 'finished airing') {
            status = 'Completed';
            nextEpisode = '';
          }

          const embed = new EmbedBuilder()
            .setTitle(selectedAnime.title)
            .setURL(selectedAnime.url)
            .setDescription(
              `**Score:** ${selectedAnime.score || 'N/A'}\n` +
              `**Episodes:** ${selectedAnime.episodes || 'N/A'}\n` +
              `**Status:** ${status}\n` +
              (nextEpisode ? `${nextEpisode}\n` : '') +
              `**Synopsis:** ${cleanSynopsis}`
            )
            .setImage(selectedAnime.images.jpg.image_url)
            .setColor(0x00AE86);

          await i.followUp({ embeds: [embed] });

        } catch (error) {
          if (error.code === 10062) {
            console.warn('Interaction expired before response.');
          } else {
            console.error('Error updating interaction:', error);
          }
        }
      });

      collector.on('end', async collected => {
        try {
          if (collected.size === 0) {
            const reply = await interaction.fetchReply();
            if (reply) {
              await interaction.editReply({ content: 'No selection made.', components: [] });
            }
          }
        } catch (error) {
          console.warn('Could not edit reply, message likely deleted.');
        }
      });

    } catch (error) {
      console.error('Error fetching anime from Jikan:', error.response ? error.response.data : error);
      await interaction.editReply({ content: 'Failed to fetch anime details.', components: [] });
    }
  },
};