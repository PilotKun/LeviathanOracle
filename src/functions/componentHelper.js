const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ContainerBuilder, SectionBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder, ThumbnailBuilder
} = require('discord.js');

module.exports = {
  row: (buttons) => new ActionRowBuilder().addComponents(
    buttons.map(b => new ButtonBuilder()
      .setCustomId(b.id)
      .setLabel(b.label)
      .setStyle(b.style || ButtonStyle.Primary)
      .setDisabled(b.disabled || false))
  ),

  pagination: (current, total) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(current === 1),
    new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(current === total)
  ),

  container: (options = {}) => {
    const c = new ContainerBuilder();
    if (options.color) c.setAccentColor(options.color);
    if (options.spoiler) c.setSpoiler(true);
    return c;
  },

  section: (texts, accessory) => {
    const s = new SectionBuilder();
    const items = Array.isArray(texts) ? texts : [texts];
    s.addTextDisplayComponents(items.map(t =>
      typeof t === 'string' ? new TextDisplayBuilder().setContent(t) : t
    ));
    if (accessory?.url) s.setThumbnailAccessory(new ThumbnailBuilder().setURL(accessory.url));
    else if (accessory?.customId) s.setButtonAccessory(
      new ButtonBuilder().setCustomId(accessory.customId).setLabel(accessory.label || '').setStyle(accessory.style || ButtonStyle.Primary)
    );
    return s;
  },

  text: (content) => new TextDisplayBuilder().setContent(content),

  separator: (options = {}) => {
    const s = new SeparatorBuilder();
    if (options.divider !== undefined) s.setDivider(options.divider);
    if (options.spacing) s.setSpacing(options.spacing === 'large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
    return s;
  },

  thumbnail: (url, options = {}) => {
    const t = new ThumbnailBuilder().setURL(url);
    if (options.description) t.setDescription(options.description);
    if (options.spoiler) t.setSpoiler(true);
    return t;
  },

  gallery: (items) => new MediaGalleryBuilder().addItems(
    items.map(i => {
      const item = new MediaGalleryItemBuilder().setURL(i.url);
      if (i.description) item.setDescription(i.description);
      if (i.spoiler) item.setSpoiler(true);
      return item;
    })
  )
};
