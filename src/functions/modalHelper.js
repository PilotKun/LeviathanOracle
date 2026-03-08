const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
  modal: (options) => {
    const modal = new ModalBuilder()
      .setCustomId(options.id)
      .setTitle(options.title);

    const inputs = options.inputs.map(input => {
      const textInput = new TextInputBuilder()
        .setCustomId(input.id)
        .setLabel(input.label)
        .setStyle(input.style || TextInputStyle.Short)
        .setRequired(input.required ?? true);

      if (input.placeholder) textInput.setPlaceholder(input.placeholder);
      if (input.minLength) textInput.setMinLength(input.minLength);
      if (input.maxLength) textInput.setMaxLength(input.maxLength);
      if (input.value) textInput.setValue(input.value);

      return new ActionRowBuilder().addComponents(textInput);
    });

    modal.addComponents(...inputs);
    return modal;
  },

  textInput: (options) => {
    const input = new TextInputBuilder()
      .setCustomId(options.id)
      .setLabel(options.label)
      .setStyle(options.style || TextInputStyle.Short)
      .setRequired(options.required ?? true);

    if (options.placeholder) input.setPlaceholder(options.placeholder);
    if (options.minLength) input.setMinLength(options.minLength);
    if (options.maxLength) input.setMaxLength(options.maxLength);
    if (options.value) input.setValue(options.value);

    return input;
  }
};