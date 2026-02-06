const { EmbedBuilder } = require('discord.js');
const { emojis } = require('./config.js');

const createEmbed = (type, description) => {
    let color, title;
    switch (type) {
        case 'success':
            color = 0x2ECC71;
            title = 'Success';
            break;
        case 'error':
            color = 0xE74C3C;
            title = 'Error';
            break;
        case 'warn':
            color = 0xF1C40F;
            title = 'Warning';
            break;
        case 'info':
        default:
            color = 0x3498DB;
            title = 'Info';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: 'Universal Moderation' })
        .setTimestamp();
};

const createModerationEmbed = (description) => {
    return new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('Moderation')
        .setDescription(description)
        .setFooter({ text: 'Universal Moderation' })
        .setTimestamp();
};

module.exports = {
    success: (text) => createEmbed('success', text),
    error: (text) => createEmbed('error', text),
    warn: (text) => createEmbed('warn', text),
    info: (text) => createEmbed('info', text),
    moderation: (text) => createModerationEmbed(text)
};