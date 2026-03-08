const { EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

const createEmbed = (options = {}) => {
  const embed = new EmbedBuilder()
    .setColor(options.color || '#0099ff')
    .setTimestamp();

  if (options.title) embed.setTitle(options.title);
  if (options.url) embed.setURL(options.url);
  if (options.desc || options.description) embed.setDescription(options.desc || options.description);
  if (options.fields) embed.addFields(options.fields);
  if (options.footer) embed.setFooter(typeof options.footer === 'string' ? { text: options.footer } : options.footer);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.author) embed.setAuthor(typeof options.author === 'string' ? { name: options.author } : options.author);

  return embed;
};

createEmbed.v2 = (options = {}) => {
  const c = new ContainerBuilder();
  if (options.color) c.setAccentColor(options.color);
  if (options.title) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${options.title}`));
  if (options.title && (options.desc || options.description))
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  if (options.desc || options.description)
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(options.desc || options.description));
  if (options.fields?.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    options.fields.forEach(f =>
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${f.name}**\n${f.value}`))
    );
  }
  if (options.footer) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const footerText = typeof options.footer === 'string' ? options.footer : options.footer.text;
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footerText}`));
  }
  return c;
};

module.exports = createEmbed;
